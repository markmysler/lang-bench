# Node.js + Express

- **Server:** Express 5 on Node's `node:http`, in `node:24-trixie-slim` with
  `NODE_ENV=production`. Express runs with its defaults otherwise (ETags and the `X-Powered-By`
  header stay on, Node's default keep-alive timeout), and nothing is logged per request.
- **Concurrency:** one single-threaded event loop per process. The primary process uses
  `node:cluster` to fork `CPUS` workers, which share port 8080, so every pinned core runs a
  worker. The primary only supervises and restarts a worker that exits.
- **Database:** a node-postgres (`pg`) pool in each worker of `max(1, floor(DB_POOL / CPUS))`
  connections, so the container never opens more than `DB_POOL`. Queries use named prepared
  statements, prepared once per connection. The pool connects on first use.
- **`/io`:** `await setTimeout(ms)` from `node:timers/promises`, which frees the event loop
  while it waits. libuv timers can fire up to ~1ms early (deadlines use the loop's cached clock),
  so any shortfall, measured with `performance.now()`, is waited out with one more timer.
