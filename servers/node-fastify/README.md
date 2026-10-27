# Node.js + Fastify

- **Server:** Fastify 5 on Node's `node:http`, in `node:24-trixie-slim` with
  `NODE_ENV=production`. Fastify runs with its defaults (no logger, Node's default keep-alive
  timeout), so nothing is logged per request. No response schemas are declared, so replies are
  serialised with `JSON.stringify` rather than Fastify's schema-compiled serialiser; declaring
  them would be faster but is not something [node-express](../node-express/README.md) can do.
  The Node image, cluster setup, pg version, pool split, queries and `/io` wait are the same as
  node-express, so the two differ only in the framework.
- **Concurrency:** one single-threaded event loop per process. The primary process uses
  `node:cluster` to fork `CPUS` workers, which share port 8080, so every pinned core runs a
  worker. The primary only supervises and restarts a worker that exits.
- **Database:** a node-postgres (`pg`) pool in each worker of `max(1, floor(DB_POOL / CPUS))`
  connections, so the container never opens more than `DB_POOL`. Queries use named prepared
  statements, prepared once per connection. The pool connects on first use.
- **`/io`:** `await setTimeout(ms)` from `node:timers/promises`, which frees the event loop
  while it waits. libuv timers can fire up to ~1ms early (deadlines use the loop's cached clock),
  so any shortfall, measured with `performance.now()`, is waited out with one more timer.
