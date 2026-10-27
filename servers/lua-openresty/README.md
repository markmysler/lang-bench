# Lua + OpenResty

- **Server:** OpenResty 1.31 (nginx with LuaJIT 2.1), from OpenResty's own Debian packages, in
  `debian:trixie-slim`. OpenResty has no trixie image or packages yet, and trixie's apt refuses
  the SHA-1 binding on OpenResty's signing key, so a bookworm build stage downloads the bookworm
  packages through apt (which checks their signatures) and the final trixie image installs them.
  They bring their own OpenSSL, PCRE2 and zlib, and need only libc from the base. Every endpoint,
  `/health` and `/plaintext` included, runs a Lua handler (`app.lua`); JSON is encoded with cjson
  per request. The access log is off.
- **Concurrency:** `worker_processes` is set to `CPUS` when the container starts (`start.sh`), with
  4096 `worker_connections` each. Each worker runs one nginx event loop, and each request runs in
  its own Lua coroutine that yields while it waits on a socket or timer. `listen ... reuseport`
  gives each worker its own listening socket. nginx closes a keep-alive connection after 1000
  requests by default; the other servers never do, so `keepalive_requests` is raised to 1,000,000.
- **Database:** pgmoon 1.18 over nginx cosockets, pinned with its checksum in `lua-deps.lock`.
  Each worker keeps a cosocket pool of `max(1, floor(DB_POOL / CPUS))` connections, so the
  container never opens more than `DB_POOL`, and a semaphore of the same size caps the connections
  in use: the cosocket pool's own limit (`backlog`) lets the pool overflow under load and keeps
  closing and reopening connections. Connections open on first use. pgmoon has no named prepared
  statements: a query with parameters is sent as an unnamed statement (parse, bind and execute in
  one round trip), so Postgres parses it every time. pgmoon declares a Lua number parameter as
  `numeric`, which would make Postgres scan the whole table, so the query casts it to `integer`.
- **`/io`:** `ngx.sleep`, which suspends only the request's coroutine. nginx sets timers from its
  cached clock, so they can fire early; any shortfall, measured with `clock_gettime` (through
  LuaJIT's FFI), is waited out with another sleep.
- **Note:** cjson writes object keys in hash order, so `/cpu` returns `{"fib":F,"n":N}`; JSON
  objects are unordered, so the response is equivalent.
