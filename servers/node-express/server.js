// Node.js + Express server for lang-bench (docs/SPEC.md).
import cluster from 'node:cluster';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import pg from 'pg';

function env(key, def) {
  const n = Number.parseInt(process.env[key], 10);
  return n > 0 ? n : def;
}

const cpus = env('CPUS', os.availableParallelism());

if (cluster.isPrimary) {
  // The primary only supervises: it forks one worker per CPU and the workers share port 8080.
  for (let i = 0; i < cpus; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`worker ${worker.process.pid} exited (${signal || code}), restarting`);
    cluster.fork();
  });
  // As PID 1 in the container, node has no default signal handlers, so exit explicitly on stop.
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
} else {
  worker();
}

// wait sleeps for at least ms milliseconds. libuv computes timer deadlines from the loop's cached
// clock, so a timer can fire up to ~1ms early; any shortfall is waited out with another timer.
async function wait(ms) {
  const end = performance.now() + ms;
  await sleep(ms);
  for (let left = end - performance.now(); left > 0; left = end - performance.now()) {
    await sleep(Math.ceil(left));
  }
}

function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
function param(req, name, def, lo, hi) {
  let v = req.query[name];
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string' || !/^[+-]?\d+$/.test(v)) return def;
  return Math.max(lo, Math.min(hi, Number(v)));
}

function worker() {
  // DB_POOL is for the whole container, so each worker gets an equal share of it.
  // The pool connects on first use, so the server starts without a database for other workloads.
  const db = new pg.Pool({
    host: process.env.DB_HOST,
    port: env('DB_PORT', 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: Math.max(1, Math.floor(env('DB_POOL', 16) / cpus)),
  });
  // An idle connection dropped by the server must not crash the worker.
  db.on('error', (err) => console.error(err.message));

  async function randomRow() {
    // A named statement is prepared once per connection and reused after that.
    const { rows } = await db.query({
      name: 'world',
      text: 'SELECT id, randomnumber FROM world WHERE id = $1',
      values: [1 + Math.floor(Math.random() * 10000)],
    });
    return { id: rows[0].id, randomNumber: rows[0].randomnumber };
  }

  const app = express();
  app.get('/health', (req, res) => res.type('text/plain').send('ok'));
  app.get('/plaintext', (req, res) => res.type('text/plain').send('Hello, World!'));
  app.get('/json', (req, res) => res.json({ message: 'Hello, World!' }));
  app.get('/cpu', (req, res) => {
    const n = param(req, 'n', 20, 0, 32);
    res.json({ n, fib: fib(n) });
  });
  app.get('/io', async (req, res) => {
    const ms = param(req, 'ms', 10, 0, 1000);
    await wait(ms);
    res.json({ ms });
  });
  app.get('/db', async (req, res) => {
    try {
      res.json(await randomRow());
    } catch (err) {
      res.status(500).type('text/plain').send(err.message);
    }
  });
  app.get('/queries', async (req, res) => {
    const rows = new Array(param(req, 'n', 1, 1, 500));
    try {
      for (let i = 0; i < rows.length; i++) rows[i] = await randomRow();
    } catch (err) {
      res.status(500).type('text/plain').send(err.message);
      return;
    }
    res.json(rows);
  });
  app.listen(env('PORT', 8080), '0.0.0.0', (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
}
