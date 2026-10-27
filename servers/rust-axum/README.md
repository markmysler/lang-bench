# Rust + Axum

- **Server:** Axum on hyper (HTTP/1.1), compiled with `cargo build --release` (default release
  profile) to a native binary, in `debian:trixie-slim`.
- **Concurrency:** one async task per connection on Tokio's multi-thread, work-stealing runtime.
  The runtime is built explicitly with `worker_threads = CPUS` rather than `#[tokio::main]`,
  whose default is the number of cores it detects, so it uses exactly the cores the container is
  pinned to.
- **Database:** sqlx `PgPool` of `DB_POOL` connections, created with `connect_lazy` so the server
  starts without a database. sqlx prepares and caches statements on each connection by default.
- **`/io`:** `tokio::time::sleep`, which suspends only the task and frees the worker thread.
