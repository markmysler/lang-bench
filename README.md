# lang-bench

[![CI](https://github.com/markmysler/lang-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/markmysler/lang-bench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Compare web server languages and frameworks for throughput, latency, CPU, memory and start-up
time, each in an identical Docker container: the same OS, the same pinned CPU cores, the same
memory. Watch every server under load live, second by second, then compare the results side by
side.

**[See published results](https://markmysler.github.io/lang-bench/)**, or run it on your own
machine:

```sh
git clone https://github.com/markmysler/lang-bench
cd lang-bench
docker compose up --build
```

Then open http://localhost:7070, build the images you want (the dashboard offers a button), and
start a run. Docker is the only requirement.

## What is measured

Every server implements the same six endpoints with byte-for-byte the same responses
([docs/SPEC.md](docs/SPEC.md)), checked by a conformance test:

| Workload       | What it shows                                                     |
| -------------- | ----------------------------------------------------------------- |
| Plaintext      | The HTTP server and router alone                                  |
| JSON           | Plus serialisation                                                |
| CPU            | The language itself: naive recursive `fib(n)`                     |
| I/O wait       | The concurrency model: how many slow upstream calls it can hold   |
| Database       | The Postgres driver and pool: one row per request                 |
| Queries        | Many round trips per request                                      |

For each server and workload a run records requests per second, latency percentiles (p50 to
p99.9 and max), CPU use, requests per second per core, memory, and failed requests, plus start-up
time, idle memory and image size per server. The Learn section of the dashboard explains each
number.

## Servers

| Language   | Framework    | Runtime                                                                    | Server                 |
| ---------- | ------------ | -------------------------------------------------------------------------- | ---------------------- |
| C#         | ASP.NET Core | .NET 10 CoreCLR (tiered JIT)                                               | `csharp-aspnet`        |
| C++        | Drogon       | Native binary                                                              | `cpp-drogon`           |
| Dart       | Shelf        | Dart AOT (dart compile exe)                                                | `dart-shelf`           |
| Elixir     | Phoenix      | BEAM (Erlang/OTP 29, JIT)                                                  | `elixir-phoenix`       |
| Go         | Gin          | Native binary                                                              | `go-gin`               |
| Go         | net/http     | Native binary                                                              | `go-nethttp`           |
| Java       | Spring Boot  | HotSpot JVM 25 (JIT)                                                       | `java-spring`          |
| Java       | Spring Boot  | HotSpot JVM 25 (JIT)                                                       | `java-spring-vt`       |
| JavaScript | Express      | Node.js 24 (V8 JIT)                                                        | `node-express`         |
| JavaScript | Fastify      | Node.js 24 (V8 JIT)                                                        | `node-fastify`         |
| Kotlin     | Ktor         | HotSpot JVM 25 (JIT)                                                       | `kotlin-ktor`          |
| Lua        | OpenResty    | LuaJIT 2.1 in nginx (OpenResty)                                            | `lua-openresty`        |
| PHP        | Laravel      | PHP-FPM + nginx (OPcache, no JIT)                                          | `php-laravel`          |
| PHP        | Laravel      | Octane + FrankenPHP (OPcache, no JIT)                                      | `php-laravel-octane`   |
| Python     | FastAPI      | CPython 3.14 (interpreter)                                                 | `python-fastapi`       |
| Python     | Flask        | CPython 3.14 (interpreter), gunicorn 26.2.0 sync workers                   | `python-flask`         |
| Python     | Flask        | CPython 3.14 (interpreter), gunicorn 26.2.0 gevent workers (gevent 26.9.0) | `python-flask-gevent`  |
| Python     | Flask        | CPython 3.14 (interpreter), gunicorn 26.2.0 gthread workers                | `python-flask-gthread` |
| Ruby       | Rails        | CRuby 4.0 (YJIT)                                                           | `ruby-rails`           |
| Rust       | Actix Web    | Native binary                                                              | `rust-actix`           |
| Rust       | Axum         | Native binary                                                              | `rust-axum`            |
| Swift      | Vapor        | Native binary (static Swift stdlib)                                        | `swift-vapor`          |
| TypeScript | Elysia       | Bun 1.4.4 (JavaScriptCore JIT)                                             | `bun-elysia`           |
| TypeScript | Hono         | Deno 2.9.8 (V8 JIT)                                                        | `deno-hono`            |
| Zig        | Zap          | Native binary                                                              | `zig-zap`              |

Each server's README says how it is tuned, and why where a choice could favour or penalise it.

## Fair, and reproducible

- Every image runs on Debian 13. Base images and dependencies are pinned.
- Each server, its load generator ([oha](https://github.com/hatoo/oha)) and Postgres get their
  own pinned cores. You choose the share of the machine a run may use; as many servers as fit
  run at once and the rest follow in batches. Every result says how it ran.
- Each server is tuned as it would be in production, using all the cores it is given.
- A result records the host, Docker version, commit, every setting and the exact image of every
  server. Download it as JSON from the results page.

## Without the dashboard

```sh
scripts/langbench.sh build all            # build every image
scripts/langbench.sh conform all          # check every server against the spec
scripts/langbench.sh run settings.json    # run headless; settings as in the dashboard
```

`scripts/langbench.sh` runs the orchestrator from source in Docker, so Go need not be installed.

## Development

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how a run works.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): tests, and how to add a server.

## License

[MIT](LICENSE).
