// Deno + Hono server for lang-bench (docs/SPEC.md). `deno serve --parallel` runs one copy of this
// module in each of its workers (DENO_JOBS = CPUS), and they share port 8080.
import { Hono } from 'hono';
import postgres from 'postgres';

function env(key: string, def: number): number {
  const n = Number.parseInt(Deno.env.get(key) ?? '', 10);
  return n > 0 ? n : def;
}

const cpus = env('CPUS', navigator.hardwareConcurrency);

// DB_POOL is for the whole container, so each worker gets an equal share of it. postgres.js
// connects on first use, so the server starts without a database for the other workloads.
const sql = postgres({
  host: Deno.env.get('DB_HOST'),
  port: env('DB_PORT', 5432),
  user: Deno.env.get('DB_USER'),
  password: Deno.env.get('DB_PASSWORD'),
  database: Deno.env.get('DB_NAME'),
  max: Math.max(1, Math.floor(env('DB_POOL', 16) / cpus)),
});

// wait sleeps for at least ms milliseconds. Should the timer fire early, the shortfall, measured
// with performance.now(), is waited out with another timer.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wait(ms: number) {
  const end = performance.now() + ms;
  await sleep(ms);
  for (let left = end - performance.now(); left > 0; left = end - performance.now()) {
    await sleep(Math.ceil(left));
  }
}

function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
function param(v: string | undefined, def: number, lo: number, hi: number) {
  if (v === undefined || !/^[+-]?\d+$/.test(v)) return def;
  return Math.max(lo, Math.min(hi, Number(v)));
}

async function randomRow() {
  // postgres.js prepares each query once per connection and reuses it after that.
  const id = 1 + Math.floor(Math.random() * 10000);
  const [row] = await sql`SELECT id, randomnumber FROM world WHERE id = ${id}`;
  return { id: row.id as number, randomNumber: row.randomnumber as number };
}

const app = new Hono();
app.get('/health', (c) => c.text('ok'));
app.get('/plaintext', (c) => c.text('Hello, World!'));
app.get('/json', (c) => c.json({ message: 'Hello, World!' }));
app.get('/cpu', (c) => {
  const n = param(c.req.query('n'), 20, 0, 32);
  return c.json({ n, fib: fib(n) });
});
app.get('/io', async (c) => {
  const ms = param(c.req.query('ms'), 10, 0, 1000);
  await wait(ms);
  return c.json({ ms });
});
app.get('/db', async (c) => {
  try {
    return c.json(await randomRow());
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
});
app.get('/queries', async (c) => {
  const rows = new Array(param(c.req.query('n'), 1, 1, 500));
  try {
    for (let i = 0; i < rows.length; i++) rows[i] = await randomRow();
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
  return c.json(rows);
});

export default app satisfies Deno.ServeDefaultExport;
