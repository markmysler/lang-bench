# Server contract

Every server in `servers/` implements the same HTTP endpoints with the same responses, so that
the only thing that differs between two runs is the language, runtime and framework. The
conformance check (`langbench conform`) enforces this contract, and CI runs it against every
server.

## Container

- Listens on port `8080` on all interfaces, HTTP/1.1 with keep-alive.
- Built from `servers/<id>/Dockerfile`. The final image runs on **Debian 13 (trixie)**: either
  `debian:trixie-slim` or an official language image built on it (`python:*-slim-trixie`,
  `node:*-trixie-slim`, …). The language runtime may be copied into `debian:trixie-slim` when its
  official image uses another distribution.
- Every version is pinned: base images by tag, dependencies by lock file.
- No logging per request. Errors go to stderr.
- Responses are not compressed. The load generator sends no `Accept-Encoding`, so a server whose
  defaults compress when asked still does the same work as the others.

### Environment

The orchestrator sets these for every server:

| Variable      | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `PORT`        | Always `8080`.                                                                     |
| `CPUS`        | Whole CPUs the container is pinned to. Use it to size worker processes or threads. |
| `DB_HOST`     | Postgres host (`lb-postgres`).                                                     |
| `DB_PORT`     | `5432`.                                                                            |
| `DB_USER`     | `bench`.                                                                           |
| `DB_PASSWORD` | `bench`.                                                                           |
| `DB_NAME`     | `bench`.                                                                           |
| `DB_POOL`     | Database connections for the whole container, shared out between its processes.   |

### Production tuning

Each server uses its CPUs the way it would in production: worker processes or threads sized from
`CPUS`, with the framework's recommended production server (for example uvicorn workers for
FastAPI, a Node cluster for Express). Each server's `README.md` says how it is tuned and why.

## Endpoints

All responses are `200` unless stated. JSON responses have `Content-Type: application/json`
(a `charset` parameter is allowed) and no extra fields. Numbers are JSON integers.

| Endpoint             | Response                                                     |
| -------------------- | ------------------------------------------------------------ |
| `GET /health`        | `ok` as `text/plain`. Only when the server is ready to work. |
| `GET /plaintext`     | `Hello, World!` as `text/plain`.                             |
| `GET /json`          | `{"message":"Hello, World!"}`, serialised per request.       |
| `GET /cpu?n=N`       | `{"n":N,"fib":F}`, with `F` from the recursive function below. |
| `GET /io?ms=M`       | `{"ms":M}`, sent after waiting `M` milliseconds.             |
| `GET /db`            | `{"id":I,"randomNumber":R}`, one random row of `world`.      |
| `GET /queries?n=N`   | A JSON array of `N` rows like `/db`, from `N` separate queries. |

### Parameters

A missing, empty or non-numeric parameter takes its default. A number out of range is clamped.

| Parameter        | Default | Range    |
| ---------------- | ------- | -------- |
| `/cpu` `n`       | 20      | 0 to 32  |
| `/io` `ms`       | 10      | 0 to 1000 |
| `/queries` `n`   | 1       | 1 to 500 |

### CPU-bound: `/cpu`

Computes the Fibonacci number with the naive recursion, written in the server's own language. It
must not be memoised, iterative, or delegated to a library:

```
fib(n) = n            if n < 2
fib(n) = fib(n-1) + fib(n-2)
```

This measures the language and runtime itself: interpreter, JIT or ahead-of-time compiler.

### I/O wait: `/io`

Waits `ms` milliseconds the idiomatic way for the framework, as if calling a slow upstream
service: `await asyncio.sleep` in async Python, a timer in Node, `time.Sleep` in a goroutine,
`Thread.sleep` on a worker or virtual thread in Java. The response must not arrive before the
time has passed. This shows each concurrency model: how many waits a server can hold at once.

### Database: `/db` and `/queries`

The database is Postgres, run by the orchestrator in its own container (`db/`). Table `world`
has 10,000 rows:

```sql
CREATE TABLE world (id integer PRIMARY KEY, randomnumber integer NOT NULL);
```

Ids run from 1 to 10,000 and `randomnumber` is between 1 and 10,000. Each request picks ids
uniformly at random and reads each row with its own query, through a connection pool of at most
`DB_POOL` connections. Prepared statements are used where the driver supports them. The JSON key
is `randomNumber`, in camel case.

## Manifest

Each server has a `server.json`:

```json
{
  "id": "go-gin",
  "language": "Go",
  "languageVersion": "1.26",
  "framework": "Gin",
  "frameworkVersion": "1.11.0",
  "runtime": "Go (native)",
  "concurrency": "Goroutines on all CPUs",
  "tuning": "GOMAXPROCS = CPUS"
}
```

`id` is `<language>-<framework>` in lower case and matches the folder name.
