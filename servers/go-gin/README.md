# Go + Gin

- **Server:** Gin on Go's `net/http`, compiled to a static binary, in `debian:trixie-slim`.
- **Concurrency:** one goroutine per request. `GOMAXPROCS` is set to `CPUS`, so the scheduler
  uses exactly the cores the container is pinned to.
- **Database:** pgx connection pool of `DB_POOL` connections. pgx prepares and caches statements
  automatically.
- **`/io`:** `time.Sleep`, which parks only the goroutine.
