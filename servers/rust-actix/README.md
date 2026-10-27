# Rust + Actix Web

- **Server:** Actix Web 4 (HTTP/1.1, default features), compiled with `cargo build --release`
  (default release profile) to a native binary, in `debian:trixie-slim`. The Rust image, sqlx,
  serde and rand versions are the same as [rust-axum](../rust-axum/README.md), so the two differ
  only in the framework.
- **Concurrency:** Actix runs `CPUS` workers (`HttpServer::workers`), each a thread with its own
  single-threaded Tokio runtime and its own copy of the app. Connections are spread across the
  workers and an async task stays on the worker that accepted it; there is no work stealing, unlike
  Axum's multi-thread runtime. Actix's default worker count is the number of physical cores it
  detects, which is why it is set explicitly so it uses exactly the cores the container is pinned
  to.
- **Database:** sqlx `PgPool` created with `connect_lazy`, so the server starts without a
  database. Unlike rust-axum, which has one pool of `DB_POOL`, each worker builds its own pool of
  `max(1, floor(DB_POOL / CPUS))` connections: a sqlx connection's socket belongs to the Tokio
  runtime that opened it, and sharing one pool across Actix's per-thread runtimes would have
  workers drive each other's sockets. The container never opens more than `DB_POOL`
  connections, but a worker can't borrow an idle connection from another worker's pool. sqlx
  prepares and caches statements on each connection by default.
- **`/io`:** `actix_web::rt::time::sleep` (Tokio's timer), which suspends only the task and frees
  the worker thread.
