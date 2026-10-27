# Dart + Shelf

- **Server:** Shelf 1.4 with `shelf_router`, served by `shelf_io` on `dart:io`'s `HttpServer`,
  compiled ahead of time with `dart compile exe` and run in `debian:trixie-slim` (the executable
  needs only the C library). Shelf runs with its defaults (including its `X-Powered-By` header)
  and nothing is logged per request.
- **Concurrency:** one single-threaded event loop per isolate. The main isolate spawns `CPUS - 1`
  more, and every isolate calls `shelf_io.serve` on port 8080 with `shared: true`, so the VM
  spreads connections between `CPUS` isolates, one per pinned core. Isolates share no heap, so
  this is the Dart equivalent of a Node cluster, in one process.
- **Database:** `package:postgres` (v3) `Pool` in each isolate of `max(1, floor(DB_POOL / CPUS))`
  connections, so the container never opens more than `DB_POOL`. The pool connects on first use.
  `Pool.execute` sends the query to the unnamed statement on every call (parse, bind and execute
  in one round trip), so the server instead prepares the statement once per pooled connection
  with `Connection.prepare` and reuses it, which is what the drivers of the other servers do.
- **`/io`:** `await Future.delayed`, which frees the event loop while it waits. A Dart timer can
  fire slightly before its deadline, so any shortfall, measured with a `Stopwatch`, is waited out
  with one more timer.
- **`/cpu`:** the recursion runs on the isolate's event loop, blocking that isolate while it
  computes, as CPU-bound code does in any single-threaded event loop.
