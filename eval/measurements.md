Measured by lang-bench on Intel(R) Core(TM) Ultra 9 185H under Docker (run 20261027-162746-7d9843, 2026-10-27).
Every server ran alone in
a container with 1 CPU, 512 MB, tuned for production; load came from a separate container with
its own cores. 5 s warm-up, then 15 s measured. Throughput is per container,
so on N cores expect up to about N times as much for servers that use all their cores.

## Plaintext, 64 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 106,350 | 0.56 | 1.47 | 96% | 23 MB |
| cpp-drogon | C++ | Drogon | 85,540 | 0.71 | 1.96 | 96% | 6 MB |
| csharp-aspnet | C# | ASP.NET Core | 58,265 | 1.01 | 3.40 | 98% | 44 MB |
| dart-shelf | Dart | Shelf | 13,854 | 4.36 | 8.43 | 99% | 39 MB |
| deno-hono | TypeScript | Hono | 96,263 | 0.66 | 1.47 | 97% | 29 MB |
| elixir-phoenix | Elixir | Phoenix | 17,774 | 3.41 | 6.50 | 98% | 141 MB |
| go-gin | Go | Gin | 53,941 | 1.15 | 3.03 | 98% | 8 MB |
| go-nethttp | Go | net/http | 41,561 | 1.40 | 5.05 | 97% | 7 MB |
| java-spring | Java | Spring Boot | 13,653 | 3.11 | 24.11 | 99% | 220 MB |
| java-spring-vt | Java | Spring Boot | 20,006 | 2.96 | 10.62 | 99% | 209 MB |
| kotlin-ktor | Kotlin | Ktor | 38,931 | 1.31 | 7.93 | 99% | 105 MB |
| lua-openresty | Lua | OpenResty | 76,428 | 0.77 | 1.96 | 96% | 7 MB |
| node-express | JavaScript | Express | 17,601 | 3.35 | 6.91 | 98% | 55 MB |
| node-fastify | JavaScript | Fastify | 40,730 | 1.47 | 3.47 | 98% | 57 MB |
| php-laravel | PHP | Laravel | 681 | 91.96 | 116.81 | 99% | 58 MB |
| php-laravel-octane | PHP | Laravel | 1,172 | 53.70 | 65.02 | 99% | 100 MB |
| python-fastapi | Python | FastAPI | 7,442 | 7.46 | 15.50 | 99% | 41 MB |
| python-flask | Python | Flask | 1,732 | 35.55 | 51.40 | 62% | 117 MB |
| python-flask-gevent | Python | Flask | 4,015 | 0.23 | 216.28 | 99% | 62 MB |
| python-flask-gthread | Python | Flask | 4,031 | 14.72 | 37.24 | 98% | 55 MB |
| ruby-rails | Ruby | Rails | 3,704 | 16.44 | 34.39 | 98% | 175 MB |
| rust-actix | Rust | Actix Web | 86,102 | 0.72 | 1.69 | 96% | 3 MB |
| rust-axum | Rust | Axum | 78,468 | 0.86 | 1.74 | 97% | 3 MB |
| swift-vapor | Swift | Vapor | 15,735 | 3.94 | 7.74 | 98% | 5 MB |
| zig-zap | Zig | Zap | 89,040 | 0.65 | 2.16 | 96% | 25 MB |

## JSON, 64 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 98,844 | 0.61 | 1.50 | 96% | 23 MB |
| cpp-drogon | C++ | Drogon | 68,543 | 0.90 | 2.07 | 97% | 8 MB |
| csharp-aspnet | C# | ASP.NET Core | 81,846 | 0.69 | 2.15 | 96% | 44 MB |
| dart-shelf | Dart | Shelf | 13,605 | 4.45 | 8.40 | 99% | 38 MB |
| deno-hono | TypeScript | Hono | 81,608 | 0.79 | 1.73 | 97% | 32 MB |
| elixir-phoenix | Elixir | Phoenix | 17,268 | 3.51 | 6.98 | 99% | 145 MB |
| go-gin | Go | Gin | 46,183 | 1.34 | 3.54 | 98% | 8 MB |
| go-nethttp | Go | net/http | 39,543 | 1.48 | 5.22 | 97% | 7 MB |
| java-spring | Java | Spring Boot | 27,264 | 2.20 | 6.85 | 98% | 312 MB |
| java-spring-vt | Java | Spring Boot | 22,146 | 2.91 | 6.35 | 98% | 289 MB |
| kotlin-ktor | Kotlin | Ktor | 47,606 | 1.21 | 3.95 | 98% | 118 MB |
| lua-openresty | Lua | OpenResty | 70,217 | 0.80 | 2.38 | 96% | 7 MB |
| node-express | JavaScript | Express | 16,221 | 3.58 | 7.67 | 98% | 58 MB |
| node-fastify | JavaScript | Fastify | 37,277 | 1.60 | 3.89 | 98% | 60 MB |
| php-laravel | PHP | Laravel | 705 | 88.84 | 111.07 | 99% | 59 MB |
| php-laravel-octane | PHP | Laravel | 1,224 | 51.37 | 62.62 | 99% | 100 MB |
| python-fastapi | Python | FastAPI | 6,732 | 8.14 | 18.33 | 98% | 41 MB |
| python-flask | Python | Flask | 1,700 | 36.06 | 51.81 | 65% | 122 MB |
| python-flask-gevent | Python | Flask | 3,644 | 0.26 | 214.70 | 99% | 62 MB |
| python-flask-gthread | Python | Flask | 3,777 | 15.92 | 37.73 | 98% | 55 MB |
| ruby-rails | Ruby | Rails | 3,783 | 16.10 | 35.27 | 98% | 178 MB |
| rust-actix | Rust | Actix Web | 77,882 | 0.78 | 1.93 | 97% | 3 MB |
| rust-axum | Rust | Axum | 76,004 | 0.89 | 1.73 | 97% | 3 MB |
| swift-vapor | Swift | Vapor | 13,561 | 4.53 | 9.06 | 98% | 5 MB |
| zig-zap | Zig | Zap | 84,929 | 0.67 | 2.84 | 95% | 25 MB |

## CPU: recursive fib(20) per request, 64 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 18,041 | 3.42 | 6.74 | 98% | 22 MB |
| cpp-drogon | C++ | Drogon | 35,839 | 1.66 | 3.63 | 98% | 9 MB |
| csharp-aspnet | C# | ASP.NET Core | 29,705 | 2.00 | 4.67 | 98% | 45 MB |
| dart-shelf | Dart | Shelf | 9,040 | 6.69 | 13.27 | 99% | 37 MB |
| deno-hono | TypeScript | Hono | 14,144 | 4.39 | 7.23 | 98% | 33 MB |
| elixir-phoenix | Elixir | Phoenix | 9,420 | 6.47 | 10.74 | 99% | 146 MB |
| go-gin | Go | Gin | 18,218 | 3.46 | 7.99 | 98% | 8 MB |
| go-nethttp | Go | net/http | 15,093 | 4.07 | 10.81 | 98% | 8 MB |
| java-spring | Java | Spring Boot | 14,258 | 4.16 | 15.10 | 98% | 374 MB |
| java-spring-vt | Java | Spring Boot | 13,457 | 4.62 | 8.38 | 98% | 337 MB |
| kotlin-ktor | Kotlin | Ktor | 18,350 | 3.47 | 7.47 | 98% | 128 MB |
| lua-openresty | Lua | OpenResty | 9,292 | 6.29 | 11.52 | 98% | 7 MB |
| node-express | JavaScript | Express | 7,213 | 8.08 | 18.81 | 98% | 58 MB |
| node-fastify | JavaScript | Fastify | 8,308 | 6.83 | 14.93 | 98% | 63 MB |
| php-laravel | PHP | Laravel | 544 | 114.78 | 145.70 | 98% | 59 MB |
| php-laravel-octane | PHP | Laravel | 813 | 77.37 | 93.52 | 99% | 101 MB |
| python-fastapi | Python | FastAPI | 1,257 | 28.99 | 993.72 | 99% | 41 MB |
| python-flask | Python | Flask | 1,078 | 58.29 | 72.46 | 99% | 122 MB |
| python-flask-gevent | Python | Flask | 1,047 | 59.68 | 185.07 | 99% | 63 MB |
| python-flask-gthread | Python | Flask | 1,149 | 53.27 | 89.30 | 98% | 55 MB |
| ruby-rails | Ruby | Rails | 3,068 | 20.18 | 37.05 | 99% | 180 MB |
| rust-actix | Rust | Actix Web | 26,886 | 2.34 | 4.12 | 98% | 3 MB |
| rust-axum | Rust | Axum | 29,499 | 2.15 | 3.92 | 98% | 3 MB |
| swift-vapor | Swift | Vapor | 9,330 | 6.30 | 11.89 | 99% | 5 MB |
| zig-zap | Zig | Zap | 23,946 | 2.32 | 6.24 | 98% | 25 MB |

## I/O wait: each request waits 10 ms, as for a slow upstream, 256 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 24,037 | 10.37 | 12.15 | 46% | 28 MB |
| cpp-drogon | C++ | Drogon | 24,160 | 10.31 | 11.84 | 53% | 14 MB |
| csharp-aspnet | C# | ASP.NET Core | 17,967 | 13.78 | 22.26 | 31% | 62 MB |
| dart-shelf | Dart | Shelf | 14,445 | 17.07 | 24.58 | 97% | 43 MB |
| deno-hono | TypeScript | Hono | 20,833 | 12.02 | 14.80 | 30% | 48 MB |
| elixir-phoenix | Elixir | Phoenix | 18,711 | 13.12 | 19.16 | 86% | 160 MB |
| go-gin | Go | Gin | 20,235 | 12.13 | 17.54 | 47% | 16 MB |
| go-nethttp | Go | net/http | 18,905 | 12.82 | 21.68 | 57% | 15 MB |
| java-spring | Java | Spring Boot | 15,611 | 15.01 | 29.52 | 95% | 491 MB |
| java-spring-vt | Java | Spring Boot | 14,571 | 16.75 | 37.37 | 75% | 444 MB |
| kotlin-ktor | Kotlin | Ktor | 21,766 | 11.31 | 17.46 | 56% | 392 MB |
| lua-openresty | Lua | OpenResty | 20,839 | 12.00 | 14.90 | 22% | 10 MB |
| node-express | JavaScript | Express | 14,188 | 16.66 | 35.39 | 92% | 68 MB |
| node-fastify | JavaScript | Fastify | 17,462 | 13.51 | 27.96 | 76% | 69 MB |
| php-laravel | PHP | Laravel | 591 | 412.91 | 458.02 | 96% | 62 MB |
| php-laravel-octane | PHP | Laravel | 86 | 1992.71 | 3000.85 | 17% | 116 MB |
| python-fastapi | Python | FastAPI | 5,901 | 27.50 | 806.95 | 98% | 47 MB |
| python-flask | Python | Flask | 276 | 915.07 | 931.99 | 18% | 122 MB |
| python-flask-gevent | Python | Flask | 2,956 | 71.00 | 183.04 | 99% | 67 MB |
| python-flask-gthread | Python | Flask | 374 | 678.40 | 685.90 | 19% | 57 MB |
| ruby-rails | Ruby | Rails | 279 | 903.07 | 929.36 | 17% | 185 MB |
| rust-actix | Rust | Actix Web | 20,772 | 12.10 | 14.39 | 23% | 9 MB |
| rust-axum | Rust | Axum | 21,042 | 11.90 | 13.93 | 24% | 9 MB |
| swift-vapor | Swift | Vapor | 11,891 | 20.74 | 33.53 | 80% | 9 MB |
| zig-zap | Zig | Zap | 98 | 1807.89 | 3550.85 | 1% | 25 MB |

## Database: one random row from Postgres, 64 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 31,596 | 1.94 | 4.10 | 98% | 27 MB |
| cpp-drogon | C++ | Drogon | 24,217 | 2.42 | 6.55 | 98% | 17 MB |
| csharp-aspnet | C# | ASP.NET Core | 20,871 | 2.62 | 9.23 | 99% | 58 MB |
| dart-shelf | Dart | Shelf | 6,054 | 10.21 | 16.32 | 99% | 41 MB |
| deno-hono | TypeScript | Hono | 17,995 | 3.36 | 7.75 | 98% | 53 MB |
| elixir-phoenix | Elixir | Phoenix | 9,116 | 6.80 | 11.50 | 99% | 153 MB |
| go-gin | Go | Gin | 22,138 | 2.68 | 6.00 | 98% | 12 MB |
| go-nethttp | Go | net/http | 19,543 | 2.96 | 7.10 | 98% | 11 MB |
| java-spring | Java | Spring Boot | 7,668 | 4.67 | 77.87 | 100% | 499 MB |
| java-spring-vt | Java | Spring Boot | 12,731 | 4.59 | 12.39 | 99% | 307 MB |
| kotlin-ktor | Kotlin | Ktor | 19,448 | 2.86 | 10.98 | 99% | 425 MB |
| lua-openresty | Lua | OpenResty | 20,489 | 2.98 | 5.31 | 98% | 10 MB |
| node-express | JavaScript | Express | 9,034 | 6.66 | 17.28 | 99% | 75 MB |
| node-fastify | JavaScript | Fastify | 9,423 | 6.40 | 14.54 | 98% | 77 MB |
| php-laravel | PHP | Laravel | 149 | 410.44 | 486.58 | 94% | 74 MB |
| php-laravel-octane | PHP | Laravel | 732 | 85.48 | 104.99 | 87% | 105 MB |
| python-fastapi | Python | FastAPI | 3,706 | 16.10 | 36.50 | 99% | 46 MB |
| python-flask | Python | Flask | 1,529 | 41.54 | 57.99 | 86% | 123 MB |
| python-flask-gevent | Python | Flask | 1,905 | 31.69 | 53.83 | 98% | 67 MB |
| python-flask-gthread | Python | Flask | 2,119 | 28.92 | 40.84 | 98% | 57 MB |
| ruby-rails | Ruby | Rails | 2,505 | 24.59 | 35.99 | 99% | 191 MB |
| rust-actix | Rust | Actix Web | 15,071 | 4.19 | 6.70 | 99% | 10 MB |
| rust-axum | Rust | Axum | 13,238 | 4.83 | 7.33 | 99% | 9 MB |
| swift-vapor | Swift | Vapor | 4,692 | 13.21 | 20.88 | 99% | 9 MB |
| zig-zap | Zig | Zap | 6,552 | 9.32 | 20.34 | 45% | 25 MB |

## Database: 20 separate queries per request, 64 connections

| Server | Language | Framework | Requests/s | p50 ms | p99 ms | CPU | Peak memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bun-elysia | TypeScript | Elysia | 4,458 | 13.76 | 26.11 | 99% | 33 MB |
| cpp-drogon | C++ | Drogon | 2,402 | 26.41 | 39.26 | 98% | 17 MB |
| csharp-aspnet | C# | ASP.NET Core | 1,983 | 31.31 | 43.13 | 99% | 60 MB |
| dart-shelf | Dart | Shelf | 870 | 72.01 | 89.59 | 99% | 41 MB |
| deno-hono | TypeScript | Hono | 589 | 105.83 | 144.56 | 99% | 53 MB |
| elixir-phoenix | Elixir | Phoenix | 1,095 | 57.44 | 70.37 | 99% | 154 MB |
| go-gin | Go | Gin | 2,535 | 23.35 | 44.98 | 96% | 12 MB |
| go-nethttp | Go | net/http | 2,631 | 22.70 | 42.16 | 97% | 11 MB |
| java-spring | Java | Spring Boot | 1,254 | 33.83 | 236.30 | 100% | 500 MB |
| java-spring-vt | Java | Spring Boot | 1,699 | 35.21 | 94.16 | 98% | 307 MB |
| kotlin-ktor | Kotlin | Ktor | 1,705 | 32.57 | 112.65 | 100% | 420 MB |
| lua-openresty | Lua | OpenResty | 1,437 | 43.56 | 59.56 | 88% | 11 MB |
| node-express | JavaScript | Express | 1,062 | 57.83 | 103.99 | 99% | 72 MB |
| node-fastify | JavaScript | Fastify | 1,026 | 60.25 | 105.58 | 99% | 75 MB |
| php-laravel | PHP | Laravel | 93 | 628.30 | 789.44 | 96% | 75 MB |
| php-laravel-octane | PHP | Laravel | 123 | 498.52 | 586.66 | 63% | 105 MB |
| python-fastapi | Python | FastAPI | 456 | 132.43 | 281.15 | 99% | 46 MB |
| python-flask | Python | Flask | 441 | 141.56 | 178.10 | 99% | 123 MB |
| python-flask-gevent | Python | Flask | 369 | 169.46 | 205.03 | 99% | 66 MB |
| python-flask-gthread | Python | Flask | 504 | 122.28 | 154.25 | 98% | 56 MB |
| ruby-rails | Ruby | Rails | 557 | 112.10 | 132.63 | 98% | 192 MB |
| rust-actix | Rust | Actix Web | 1,083 | 59.19 | 67.27 | 98% | 10 MB |
| rust-axum | Rust | Axum | 962 | 67.09 | 79.15 | 98% | 9 MB |
| swift-vapor | Swift | Vapor | 330 | 190.10 | 221.62 | 99% | 9 MB |
| zig-zap | Zig | Zap | 419 | 102.90 | 1114.59 | 36% | 25 MB |

## Servers

| Server | Start-up | Idle memory | Image size |
| --- | --- | --- | --- |
| bun-elysia | 513 ms | 13 MB | 184 MB |
| cpp-drogon | 295 ms | 4 MB | 82 MB |
| csharp-aspnet | 785 ms | 20 MB | 222 MB |
| dart-shelf | 273 ms | 3 MB | 83 MB |
| deno-hono | 525 ms | 23 MB | 169 MB |
| elixir-phoenix | 1,720 ms | 144 MB | 165 MB |
| go-gin | 293 ms | 2 MB | 92 MB |
| go-nethttp | 238 ms | 2 MB | 85 MB |
| java-spring | 5,939 ms | 134 MB | 287 MB |
| java-spring-vt | 6,224 ms | 131 MB | 287 MB |
| kotlin-ktor | 1,852 ms | 68 MB | 298 MB |
| lua-openresty | 260 ms | 6 MB | 96 MB |
| node-express | 706 ms | 38 MB | 228 MB |
| node-fastify | 593 ms | 43 MB | 233 MB |
| php-laravel | 824 ms | 52 MB | 526 MB |
| php-laravel-octane | 1,283 ms | 94 MB | 629 MB |
| python-fastapi | 895 ms | 40 MB | 177 MB |
| python-flask | 996 ms | 115 MB | 152 MB |
| python-flask-gevent | 841 ms | 60 MB | 166 MB |
| python-flask-gthread | 606 ms | 52 MB | 152 MB |
| ruby-rails | 2,671 ms | 99 MB | 234 MB |
| rust-actix | 239 ms | 1 MB | 83 MB |
| rust-axum | 238 ms | 1 MB | 79 MB |
| swift-vapor | 329 ms | 3 MB | 195 MB |
| zig-zap | 733 ms | 23 MB | 78 MB |
