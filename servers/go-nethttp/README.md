# Go + net/http

- **Server:** Go's standard library only: `net/http` with the Go 1.22+ `ServeMux` method and path
  patterns (`GET /json`), and `encoding/json` for responses. Compiled to a static binary, in
  `debian:trixie-slim`. The Go toolchain, image, pgx version and pool settings are the same as
  [go-gin](../go-gin/README.md), so the two differ only in the framework. The `net/http` version
  is the Go version. `x/sync` and `x/text` are pinned to the versions go-gin resolves, so pgx runs
  on the same dependencies in both.
- **Concurrency:** one goroutine per connection, from `net/http`. `GOMAXPROCS` is set to `CPUS`,
  so the scheduler uses exactly the cores the container is pinned to.
- **Database:** pgx connection pool of `DB_POOL` connections. pgx prepares and caches statements
  automatically. Queries use the request's context, so they are cancelled if the client goes away
  (Gin's context is not cancelled that way; under the benchmark load clients don't disconnect).
- **`/io`:** `time.Sleep`, which parks only the goroutine.
