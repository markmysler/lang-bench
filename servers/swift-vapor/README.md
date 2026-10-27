# Swift + Vapor

- **Server:** Vapor 4 on SwiftNIO (HTTP/1.1), built with `swift build -c release
  --static-swift-stdlib` in `swift:6.4.1-noble` and run in `debian:trixie-slim`. The Swift runtime
  and Foundation are linked in statically, so the image adds nothing to the base: the remaining
  dynamic libraries (glibc, libstdc++, libgcc, zlib) are already in it. The build image is Ubuntu
  24.04, whose glibc (2.39) is older than trixie's (2.41). The binary uses the system allocator;
  Vapor's project template links jemalloc, which is left out so the server is not given an
  allocator the others don't have.
- **Concurrency:** SwiftNIO event loops, one thread per pinned core: the
  `MultiThreadedEventLoopGroup` is created explicitly with `CPUS` threads and handed to Vapor,
  instead of Vapor's default of the core count NIO detects. Handlers are `async`; Vapor runs them
  on Swift's concurrency pool and hops back to the connection's event loop to write the response.
  NIO is not installed as the global concurrency executor (Vapor's template leaves that commented
  out), so Swift's cooperative pool keeps its own threads beside the event loops.
- **Logging:** Vapor's default middleware logs every request, so the middleware is replaced with
  the error handler alone, and the log level is `notice`, to stderr.
- **Database:** Fluent with `FluentPostgresDriver` (PostgresNIO), reading a `World` model with
  `World.find`. Fluent keeps one pool per event loop, so each gets
  `max(1, floor(DB_POOL / CPUS))` connections and the container never opens more than `DB_POOL`.
  The pools connect on first use. Fluent's generated query is sent with the extended protocol on
  the unnamed statement (parse, bind and execute each time); Fluent has no prepared-statement
  cache, so unlike the drivers of most other servers it does not reuse a prepared statement. The
  ORM's per-row model decoding is part of what is measured.
- **`/io`:** `try await Task.sleep(until:)` on the continuous clock, which suspends only the task;
  if it ever wakes before the deadline it sleeps again.
