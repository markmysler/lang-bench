# Ruby + Rails

- **Server:** Rails 8.1 as an API-only app (`ActionController::API`, only Active Record and Action
  Controller loaded, as `rails new --api --minimal` makes it) on Puma 8, CRuby 4.0 in
  `ruby:4.0.9-slim-trixie` with `RAILS_ENV=production`. YJIT is on (`RUBY_YJIT_ENABLE=1`). Rails
  keeps its default API middleware (request id, ETags, security headers, `X-Runtime`); the log
  level is `warn`, so nothing is logged per request.
- **Concurrency:** Puma in cluster mode with `CPUS` worker processes, each with 3 threads (Rails'
  default `RAILS_MAX_THREADS`), and `preload_app!` so the workers fork from a booted app. The GVL
  lets only one thread per process run Ruby at a time, so the processes use the cores and the
  threads overlap waits on I/O and the database. A single worker still runs in cluster mode, so
  1 CPU is tuned the same way as more.
- **Database:** Active Record (`World.find`, a prepared `SELECT` by primary key) with the
  PostgreSQL adapter; the `pg` gem comes prebuilt with its own libpq. The pool in each worker has
  one connection per thread (3), the size Rails recommends: a thread holds a connection for the
  whole request, so more would never be used. **`DB_POOL` is not used**: the container opens at
  most `3 × CPUS` connections, which is below `DB_POOL` at the usual sizes but would exceed it on
  more than `DB_POOL / 3` CPUs. Active Record connects on the first query, so the server starts
  without a database.
- **`/io`:** `sleep` in the request thread, which releases the GVL. With 3 threads per worker,
  each process holds at most 3 waits at once, so `/io` throughput is bounded by
  `3 × CPUS / ms`: this is how a default-tuned Rails app behaves. Any shortfall measured on the
  monotonic clock is slept out, so the answer never comes early.
- **`/cpu`:** the recursion runs in the request thread under YJIT, holding the GVL while it
  computes.
