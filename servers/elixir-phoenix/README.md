# Elixir + Phoenix

- **Server:** Phoenix 1.8 on Bandit (Phoenix's default adapter), Elixir 1.20 on Erlang/OTP 29
  with the BEAM JIT. A minimal app with the plugs `mix phx.new --no-html` generates (request id,
  telemetry, parsers, method override, HEAD), without HTML, assets, mailer, LiveView, dashboard or
  sessions. Built in `elixir:1.20.4-otp-29` (trixie) as a `mix release`, which carries its own
  ERTS, and run in `debian:trixie-slim` with only the libraries it needs. The log level is
  `warning`, so nothing is logged per request. The release starts with distribution off (no
  epmd), as a single node needs none.
- **Concurrency:** one BEAM process per request (Bandit runs one per connection and request),
  scheduled preemptively by the BEAM. `rel/env.sh.eex` sets `ERL_FLAGS="+S CPUS:CPUS"`, so there
  is one scheduler thread per pinned core; the BEAM would otherwise size them from the host's
  cores. One OS process serves the whole container.
- **Database:** Ecto with Postgrex and a single pool of `DB_POOL` connections, since there is
  only one process (`Repo.get!`, a prepared `SELECT` by primary key; Postgrex prepares and caches
  queries on each connection). Ecto opens the pool's connections in the background when the app
  starts rather than on first use; while the database is unreachable they retry with backoff and
  log the failure, and the server starts and serves the other endpoints. Ecto's queueing defaults
  are kept (`queue_target` 50 ms, `queue_interval` 1 s): under sustained pool contention it sheds
  requests that wait too long with a 500 instead of queueing them without limit, as the other
  servers' pools do. The load checks at 1 CPU (`/queries?n=20` with up to 256 connections, `/db`
  with 512) dropped none.
- **`/io`:** `Process.sleep`, which suspends only the request's process. BEAM timers never fire
  before their time, so no deadline re-check is needed.
- **`/cpu`:** the recursion runs in the request's process; the scheduler preempts it, so other
  requests keep being served while it computes.
