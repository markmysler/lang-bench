# Python + FastAPI

- **Server:** FastAPI on uvicorn 0.54 with `uvicorn[standard]` (uvloop event loop, httptools HTTP
  parser), CPython 3.14 in `python:3.14.10-slim-trixie`. Access logging is off.
- **Concurrency:** `--workers CPUS` uvicorn worker processes, the usual production setup: CPython
  runs Python code on one core per process (GIL), so one process per pinned CPU uses them all.
  Each process runs a single asyncio event loop with `async def` handlers.
- **Database:** asyncpg pool in each worker with `max(1, DB_POOL / CPUS)` connections, so the
  container stays within `DB_POOL`. The pool has `min_size=0` and connects on first use, so the
  server starts without a database. asyncpg prepares and caches statements automatically.
- **`/io`:** `await asyncio.sleep`, which suspends only the request's coroutine.
- **`/cpu`:** the recursion runs on the event loop, blocking that worker while it computes; that is
  what CPU-bound Python code does in an async server.
