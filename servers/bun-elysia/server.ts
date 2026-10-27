// Bun + Elysia server for lang-bench (docs/SPEC.md). launcher.ts starts one of these per CPU.
import { SQL } from 'bun';
import { Elysia } from 'elysia';

function env(key: string, def: number): number {
  const n = Number.parseInt(process.env[key] ?? '', 10);
  return n > 0 ? n : def;
}

const cpus = env('CPUS', navigator.hardwareConcurrency);

// DB_POOL is for the whole container, so each process gets an equal share of it. Bun's SQL client
// connects on first use, so the server starts without a database for the other workloads.
const sql = new SQL({
  hostname: process.env.DB_HOST,
  port: env('DB_PORT', 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: Math.max(1, Math.floor(env('DB_POOL', 16) / cpus)),
});

// wait sleeps for at least ms milliseconds. Should the timer fire early, the shortfall, measured
// with performance.now(), is waited out with another sleep.
async function wait(ms: number) {
  const end = performance.now() + ms;
  await Bun.sleep(ms);
  for (let left = end - performance.now(); left > 0; left = end - performance.now()) {
    await Bun.sleep(Math.ceil(left));
  }
}

function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
function param(query: Record<string, unknown>, name: string, def: number, lo: number, hi: number) {
  let v = query[name];
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string' || !/^[+-]?\d+$/.test(v)) return def;
  return Math.max(lo, Math.min(hi, Number(v)));
}

async function randomRow() {
  // A query with parameters is prepared once per connection and reused after that.
  const id = 1 + Math.floor(Math.random() * 10000);
  const [row] = await sql`SELECT id, randomnumber FROM world WHERE id = ${id}`;
  return { id: row.id as number, randomNumber: row.randomnumber as number };
}

new Elysia()
  .get('/health', () => 'ok')
  .get('/plaintext', () => 'Hello, World!')
  .get('/json', () => ({ message: 'Hello, World!' }))
  .get('/cpu', ({ query }) => {
    const n = param(query, 'n', 20, 0, 32);
    return { n, fib: fib(n) };
  })
  .get('/io', async ({ query }) => {
    const ms = param(query, 'ms', 10, 0, 1000);
    await wait(ms);
    return { ms };
  })
  .get('/db', async ({ set }) => {
    try {
      return await randomRow();
    } catch (err) {
      set.status = 500;
      return (err as Error).message;
    }
  })
  .get('/queries', async ({ query, set }) => {
    const rows = new Array(param(query, 'n', 1, 1, 500));
    try {
      for (let i = 0; i < rows.length; i++) rows[i] = await randomRow();
    } catch (err) {
      set.status = 500;
      return (err as Error).message;
    }
    return rows;
  })
  // reusePort lets every process bind port 8080; the kernel spreads connections between them.
  .listen({ hostname: '0.0.0.0', port: env('PORT', 8080), reusePort: true });
