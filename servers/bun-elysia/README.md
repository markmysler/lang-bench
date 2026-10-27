# Bun + Elysia

- **Server:** Elysia 1.4 on `Bun.serve`, run from TypeScript source by Bun 1.4 in
  `oven/bun:1.4.4-slim` (Debian trixie) with `NODE_ENV=production`. Elysia runs with its defaults
  and nothing is logged per request.
- **Concurrency:** one single-threaded event loop per process. A small launcher (`launcher.ts`)
  starts `CPUS` server processes, each listening on port 8080 with `reusePort: true`, the
  multi-core setup Bun documents: the kernel (`SO_REUSEPORT`) spreads connections between them.
  The launcher only supervises and restarts a process that exits.
- **Database:** Bun's built-in Postgres client (`new SQL(...)` from `bun`), a pool in each process
  of `max(1, floor(DB_POOL / CPUS))` connections, so the container never opens more than
  `DB_POOL`. Queries with parameters are prepared once per connection and reused. The pool connects
  on first use.
- **`/io`:** `await Bun.sleep(ms)`, which frees the event loop while it waits. Should the timer
  fire early, the shortfall, measured with `performance.now()`, is waited out with another sleep.
- **Note:** unlike `node:cluster`, where the primary hands out connections, `SO_REUSEPORT` hashes
  each new connection to a process, so with few long-lived connections the processes can be
  unevenly loaded.
