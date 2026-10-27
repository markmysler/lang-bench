# Zig + Zap

- **Server:** Zap 0.11.0 (the latest release, for Zig 0.15) on facil.io, compiled with Zig
  0.15.2 (the official tarball, pinned by version and SHA-256) with `-Doptimize=ReleaseFast
  -Dcpu=baseline`, so it targets generic x86-64 rather than the build machine's CPU. Zap builds
  facil.io (C) itself, as a shared library with `-Os`; it is shipped next to the server in
  `debian:trixie-slim`. Dependencies are pinned by commit and content hash in `build.zig.zon`.
  Nothing is logged per request (`log = false`).
- **Concurrency:** one process (`workers = 1`, Zap's recommendation) running facil.io's event loop
  on `threads = CPUS` worker threads. Request handlers are synchronous: a handler holds its
  thread until it returns, so at most `CPUS` requests are worked on at once.
- **Database:** a pg.zig pool of `DB_POOL` connections, created on the first `/db` or `/queries`
  request so the server starts without a database (if the database cannot be reached, that
  request fails with 500 and the next one tries again). Queries block the handling thread, so at
  most `CPUS` connections are busy at a time. The statement is prepared once per connection and
  cached (`cache_name`). `/queries` runs its queries one after another.
- **`/io`:** `std.Thread.sleep`, which **blocks the worker thread** for the whole wait: Zap has no
  async handlers, so this is its model. With `CPUS` threads the server holds at most `CPUS` waits
  at once (about `CPUS × 1000 / ms` requests per second for `/io`), and other requests queue
  behind them. This is expected, not a tuning mistake. The deadline is re-checked with a
  monotonic timer and any shortfall is slept again.
