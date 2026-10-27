# Deno + Hono

- **Server:** Hono 4 (from JSR) on Deno's built-in HTTP server, in `denoland/deno:debian-2.9.8`
  (Debian trixie), started with `deno serve` and only the `--allow-net --allow-env` permissions.
  Hono runs with its defaults and nothing is logged per request. Dependencies are cached at build
  time and checked against `deno.lock` (`--frozen --cached-only` at run time).
- **Concurrency:** one single-threaded event loop per worker. `deno serve --parallel` runs the
  module in `DENO_JOBS` workers, each its own V8 isolate on its own thread in one process, all
  serving port 8080; the container sets `DENO_JOBS` to `CPUS`, the way Deno documents to choose the
  worker count.
- **Database:** postgres.js (`npm:postgres`), a pool in each worker of
  `max(1, floor(DB_POOL / CPUS))` connections, so the container never opens more than `DB_POOL`.
  postgres.js prepares each query once per connection and reuses it. The pool connects on first
  use.
- **`/io`:** `await` a `setTimeout` promise, which frees the event loop while it waits. Should the
  timer fire early, the shortfall, measured with `performance.now()`, is waited out with another
  timer.
- **Note:** postgres.js runs on Deno's Node.js compatibility layer (`node:net`), not on a
  Deno-native socket API.
