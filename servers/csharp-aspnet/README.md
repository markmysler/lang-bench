# C# + ASP.NET Core

- **Server:** an ASP.NET Core Minimal API on Kestrel, published in Release as a
  framework-dependent app and run on the shared .NET 10 runtime (CoreCLR, tiered JIT with dynamic
  PGO, no ReadyToRun or Native AOT). Microsoft publishes .NET 10 images only for Ubuntu, Alpine
  and Azure Linux, so the runtime is copied from the official `aspnet:10.0.14-noble` image into
  `debian:trixie-slim`, with the libraries the official images install (ICU included, so
  globalization works as shipped). Logging is at `Warning`, so nothing is logged per request.
- **Concurrency:** async handlers on the .NET thread pool. Everything is left at the runtime's
  defaults: `Environment.ProcessorCount` comes from the container's CPU limit (so it equals
  `CPUS`), and it sizes the thread pool and Server GC (ASP.NET Core's default GC mode, one heap
  per core). The GC heap limit defaults to 75% of the container's memory.
- **Database:** an Npgsql `NpgsqlDataSource` pool with `Max Pool Size = DB_POOL`, no ORM. Each
  query takes a connection from the pool and gives it back, like the other servers, and is
  explicitly prepared; Npgsql keeps prepared statements on the physical connection, so each is
  parsed once per connection. The pool opens connections on first use. Npgsql's other defaults
  stay, including resetting session state when a connection goes back to the pool (other drivers
  don't; measured here it made about 10% difference on `/queries`, within run-to-run noise).
- **`/io`:** `await Task.Delay(ms)`, which frees the thread while it waits. The timer queue counts
  whole milliseconds, so a delay can finish up to ~1ms early; any shortfall, measured with
  `Stopwatch`, is waited out with another delay.
