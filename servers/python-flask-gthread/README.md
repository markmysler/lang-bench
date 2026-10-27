# Python + Flask (gunicorn gthread workers)

One of three Flask servers with identical `app.py` that differ only in the gunicorn worker type:
`python-flask` (sync), `python-flask-gthread` (threads) and `python-flask-gevent` (greenlets).

- **Server:** Flask 3.1 on gunicorn 26.2 with the `gthread` worker, CPython 3.14 in
  `python:3.14.10-slim-trixie`. No access log; errors go to stderr. Keep-alive is on with
  gunicorn's default 2 s timeout. Flask runs with its production defaults (`jsonify` sorts keys
  and ends the body with a newline).
- **Concurrency:** `CPUS` worker processes (CPython runs Python code on one core per process),
  each with 4 OS threads (`threads = 4`). A worker handles up to 4 requests at once; idle
  keep-alive connections wait in the worker's poller without holding a thread.
- **Database:** psycopg 3 with a `psycopg_pool.ConnectionPool` in each worker of
  `max(1, floor(DB_POOL / CPUS))` connections; with 4 threads a worker uses at most 4. The pool
  has `min_size=0` and connects on first use, so the server starts without a database. Statements
  are prepared on first use on each connection (`prepare_threshold=0`) and run in autocommit
  mode. The query releases the GIL while it waits on the socket.
- **`/io`:** `time.sleep`, which blocks only the request's thread (and releases the GIL), so up to
  `4 x CPUS` waits are held at once. The deadline is re-checked after the sleep.
- **`/cpu`:** the recursion holds the GIL, so the threads of one worker take turns on one core.
