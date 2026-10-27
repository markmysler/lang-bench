# Lessons for teaching

What we learned on 27 October 2026 while trying lang-bench as a decision tool for coding agents,
kept because it is useful for lang-bench as an educational comparison. The agent-tool work itself
was set aside; it is archived on the branches `design-agent-tool`, `phase-3-eval` and `design-v2`
(the design, the evaluation harness, its scenarios, answers and grades).

## Reference measurements

A sequential full-length run of all 25 servers (run `20261027-162746-7d9843`): each server alone,
1 CPU and 512 MB, its own load generator on separate cores, 5 s warm-up, 15 s measured, on an Intel
Core Ultra 9 185H under Docker Desktop. Requests per second:

| Server | Plaintext | I/O wait 10 ms | CPU fib(20) | One DB row | 20 queries | Start-up | Idle memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | 106,350 | 24,037 | 18,041 | 31,596 | 4,458 | 513 ms | 13 MB |
| cpp-drogon | 85,540 | 24,160 | 35,839 | 24,217 | 2,402 | 295 ms | 4 MB |
| csharp-aspnet | 58,265 | 17,967 | 29,705 | 20,871 | 1,983 | 785 ms | 20 MB |
| dart-shelf | 13,854 | 14,445 | 9,040 | 6,054 | 870 | 273 ms | 3 MB |
| deno-hono | 96,263 | 20,833 | 14,144 | 17,995 | 589 | 525 ms | 23 MB |
| elixir-phoenix | 17,774 | 18,711 | 9,420 | 9,116 | 1,095 | 1,720 ms | 144 MB |
| go-gin | 53,941 | 20,235 | 18,218 | 22,138 | 2,535 | 293 ms | 2 MB |
| go-nethttp | 41,561 | 18,905 | 15,093 | 19,543 | 2,631 | 238 ms | 2 MB |
| java-spring | 13,653 | 15,611 | 14,258 | 7,668 | 1,254 | 5,939 ms | 134 MB |
| java-spring-vt | 20,006 | 14,571 | 13,457 | 12,731 | 1,699 | 6,224 ms | 131 MB |
| kotlin-ktor | 38,931 | 21,766 | 18,350 | 19,448 | 1,705 | 1,852 ms | 68 MB |
| lua-openresty | 76,428 | 20,839 | 9,292 | 20,489 | 1,437 | 260 ms | 6 MB |
| node-express | 17,601 | 14,188 | 7,213 | 9,034 | 1,062 | 706 ms | 38 MB |
| node-fastify | 40,730 | 17,462 | 8,308 | 9,423 | 1,026 | 593 ms | 43 MB |
| php-laravel | 681 | 591 | 544 | 149 | 93 | 824 ms | 52 MB |
| php-laravel-octane | 1,172 | 86 | 813 | 732 | 123 | 1,283 ms | 94 MB |
| python-fastapi | 7,442 | 5,901 | 1,257 | 3,706 | 456 | 895 ms | 40 MB |
| python-flask | 1,732 | 276 | 1,078 | 1,529 | 441 | 996 ms | 115 MB |
| python-flask-gevent | 4,015 | 2,956 | 1,047 | 1,905 | 369 | 841 ms | 60 MB |
| python-flask-gthread | 4,031 | 374 | 1,149 | 2,119 | 504 | 606 ms | 52 MB |
| ruby-rails | 3,704 | 279 | 3,068 | 2,505 | 557 | 2,671 ms | 99 MB |
| rust-actix | 86,102 | 20,772 | 26,886 | 15,071 | 1,083 | 239 ms | 1 MB |
| rust-axum | 78,468 | 21,042 | 29,499 | 13,238 | 962 | 238 ms | 1 MB |
| swift-vapor | 15,735 | 11,891 | 9,330 | 4,692 | 330 | 329 ms | 3 MB |
| zig-zap | 89,040 | 98 | 23,946 | 6,552 | 419 | 733 ms | 23 MB |

Latency, CPU and memory for every workload are in `eval/measurements.md` on the `phase-3-eval`
branch; the run's JSON is in the local `results/` folder.

## 1. Configuration often matters more than language

The most teachable result. Within one language and framework, the way it is served changes the
numbers by an order of magnitude:

- **gunicorn workers, I/O wait:** sync 276, gthread (4 threads) 374, gevent 2,956 requests a
  second. Same Flask code; only the worker type differs.
- **Spring Boot, one database row:** platform threads 7,668, virtual threads 12,731.
- **Laravel:** PHP-FPM 681 on plaintext but 149 on one database row, mostly because PHP-FPM opens a
  new database connection on every request by default. Octane keeps workers alive (732 on one row)
  but has only one worker per CPU, so it holds just a few waits at once: 86 on I/O wait.
- **Blocking handlers:** Zap answers 23,946 CPU requests a second but only 98 on 10 ms waits,
  because each wait holds one of its few threads.

Teaching point: a number about "a language" is really a number about one configuration of it.
Every published figure should say how the server was set up, and the dashboard should show
variants side by side.

## 2. Surprises worth showing

- **Ruby with YJIT beats Python on CPU:** 3,068 against 1,047 to 1,257 for the Python servers on
  recursive fib(20).
- **Bun leads on the database row** (31,596), ahead of Go and Rust, and on plaintext (106,350).
- **C# is next to Rust on CPU** (29,705 against 29,499 for Axum).
- **The JVM pays at start and at idle:** about 6 s to start and 130 MB idle for Spring Boot,
  against 0.24 s and 1 to 2 MB for Rust and Go. Ktor on the same JVM: 1.9 s and 68 MB.
- **Elixir holds waits well** (18,711 on I/O wait) but idles at 144 MB.
- **On 20 queries per request the field narrows:** the database round trips dominate, and the
  gap between fastest and slowest drops from 156x on plaintext to 48x (13x without Laravel).

## 3. What people and AI agents get wrong

We asked Claude models (Opus, Sonnet, Haiku) to advise imaginary teams and checked every
performance claim against the measurements. About half the claims were about things not measured;
of the rest, 4 to 11% were off by more than 2x, and the misses cluster in useful places for
teaching:

- "A Go or Node rewrite might be 5 to 10 times faster than Laravel." Measured on one database row:
  about 150x for Go and 60x for Node, though much of that is PHP-FPM's per-request connection.
- "Go uses about 50 to 150 MB per pod." Measured: 2 MB idle, under 20 MB under load.
- ".NET is heavy for 512 MB" (20 MB idle) and "Drogon is heavy" (4 MB idle).
- "Go and Spring Boot are similar in raw speed." Measured 1.7x apart on JSON, 2.9x on a database
  row, 4x on plaintext.
- "One Spring Boot instance on one CPU might just cope with 200 requests a second." Measured: 7,668
  a second on one database row.
- "Threaded gunicorn workers give several times as many slots." Measured: 374 against 276; gevent
  is what gives 10x.

These make good "myth or measured?" material for the Learn section.

## 4. Architecture beats language

When given real tasks in mock repositories, agents never chose a wrong language. They went wrong
on where work runs: 50,000 WebSockets inside the REST API process with state in memory, CPU-heavy
PDF rendering on Node's event loop, live three-hop graph queries with no caching. Asked directly
which stack to use, every model chose acceptably in all 29 scenarios. For teaching: the concurrency
model and where work is placed matter more for most projects than which fast language is used.

## 5. Workloads to add for teaching

Questions people actually reason about without data, in order of value:

- **WebSockets:** connections held, memory per connection, connection rate, broadcast latency,
  behaviour at the limit. Needs a load generator beyond oha (which speaks only HTTP).
- **CPU work beside I/O:** whether a CPU-heavy request slows the fast ones next to it (event loops
  versus threads versus processes).
- **Cold start:** time to first answer and how slow the first requests are (JIT warm-up).
- **Memory under a hard limit:** throughput, pauses and kills as the limit gets close.
- **Upstream fan-out:** several slow HTTP calls per request, the real I/O case.

And variants that matter for concurrency but aren't measured yet: Laravel Reverb (its WebSocket
server), Octane on Swoole or RoadRunner, Django on ASGI.

## 6. Fairness lessons for the harness

Each of these changed results or nearly did:

- **Compression:** oha sends `Accept-Encoding: gzip, br` by default, and Caddy (in front of Octane)
  compresses bodies over 512 bytes. The load generator now sends `--disable-compression`.
- **Timers fire early:** Node's and Python asyncio's timers can wake about a millisecond before a
  sleep ends. Servers re-check a deadline so `/io` never answers early; CI caught FastAPI doing so.
- **JVM heap share:** at `MaxRAMPercentage=75`, java-spring-vt was killed for memory at 512 MB under
  256 waiting connections; 60% fixed it.
- **gunicorn sync closes every connection** (no keep-alive), which costs it on plaintext and JSON;
  Octane restarts each worker every 500 requests by default. Both are framework defaults, kept and
  documented.
- **Pool sizes and per-request connections** change database numbers more than the language does.
- **Quiet machine:** benchmarks run while other builds ran gave a 2 to 3x false gap (C# on
  queries). Reference numbers must come from a sequential run on an idle machine.
- **Checks worth automating** for any new server: the pool really opens its connections, no
  per-request logging, CPU near 100% x CPUS on the CPU workload, random rows really vary, waits
  really wait, no memory kill at 1 CPU / 512 MB, base images pinned to dated tags or digests.

## 7. Practical notes

- **Docker Hub** limits anonymous pulls; `docker login` avoids it, or pull the same tag from
  `mirror.gcr.io` or `public.ecr.aws` and confirm the digest matches.
- **Windows:** force LF line endings (`.gitattributes`), set the executable bit in git
  (`git update-index --chmod=+x`), and beware Python's 260-character path limit.
- **`.gitignore`:** a broad `build/` pattern hid `orchestrator/internal/build` from git; CI caught it.
- **Dashboard:** past eight servers, small multiples must share one y scale, or heights mislead.
