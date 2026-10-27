# C++ + Drogon

- **Server:** Drogon 1.9.14 (with its trantor submodule), built from source at the tag's commit
  in a `debian:trixie` stage with GCC 14 and a plain CMake `Release` build (CMake's default
  `-O3 -DNDEBUG`, no `-march=native`). Drogon and trantor are linked statically; jsoncpp, libpq
  and OpenSSL come from Debian 13 and are installed in `debian:trixie-slim`. There is no C++
  package manager, so the Dockerfile is the lock: Drogon is pinned by tag and commit, the system
  libraries by the dated Debian base image. Drogon's defaults are kept otherwise (its `Server`
  and `Date` headers, keep-alive and pipelining limits); the log level is `warn`, so nothing is
  logged per request.
- **Concurrency:** non-blocking event loops. `app().setThreadNum(CPUS)` runs one I/O thread per
  pinned core; each connection stays on one loop thread.
- **Database:** Drogon's async PostgreSQL `DbClient` (`newPgClient`) of `DB_POOL` connections,
  created on the first `/db` or `/queries` request so the server starts without a database. It
  opens its connections in the background, retries failed ones every second and queues queries
  until a connection is ready; a connection runs one query at a time (Drogon's `autoBatch`
  pipelining stays off, its default). Drogon prepares each parameterised statement once per
  connection. `/queries` runs its queries one after another. Two things to know:
  - The `DbClient` runs its connections on its own event loop threads,
    `min(DB_POOL, hardware threads)` of them (16 with the default pool), on the same pinned
    cores. Results are handed back to the request's I/O thread.
  - Drogon also has a "fast" `DbClient` that keeps connections on the I/O threads themselves and
    avoids that hand-off; it is not used, because its pool size is per I/O thread rather than
    `DB_POOL` for the server.
- **`/io`:** `runAfter` on the connection's event loop, a non-blocking timer, so the thread keeps
  serving other requests while it waits. The deadline is re-checked against `steady_clock` when
  the timer fires and any shortfall is waited out with another timer.
