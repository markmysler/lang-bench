# Python + Flask (gunicorn gevent workers)

One of three Flask servers with identical `app.py` that differ only in the gunicorn worker type:
`python-flask` (sync), `python-flask-gthread` (threads) and `python-flask-gevent` (greenlets).

- **Server:** Flask 3.1 on gunicorn 26.2 with the `gevent` worker (gevent 26.9), CPython 3.14 in
  `python:3.14.10-slim-trixie`. No access log; errors go to stderr. Keep-alive is on. Flask runs
  with its production defaults (`jsonify` sorts keys and ends the body with a newline).
- **Concurrency:** `CPUS` worker processes (CPython runs Python code on one core per process),
  each a gevent event loop with up to 1000 connections (`worker_connections`, gunicorn's
  default), one greenlet per connection. The worker monkey-patches the standard library before
  it imports the app, so sockets, `select` and `time.sleep` switch greenlets instead of blocking.
- **Database:** psycopg 3 with a `psycopg_pool.ConnectionPool` in each worker of
  `max(1, floor(DB_POOL / CPUS))` connections, connected on first use (`min_size=0`), so the server
  starts without a database. Statements are prepared on first use on each connection
  (`prepare_threshold=0`) and run in autocommit mode. psycopg 3 detects gevent's patched `select`
  module and then waits on the socket through it rather than in C, so a query yields to other
  greenlets (five concurrent `pg_sleep(1)` queries in one worker finish in about 1 s). This keeps
  the same driver as the sync and gthread servers; psycopg2 would need psycogreen, and a
  pure-Python driver such as pg8000 would be slower and differ from the other two.
- **`/io`:** `time.sleep`, patched by gevent into a cooperative sleep, so a worker holds as many
  waits as it has connections. The deadline is re-checked after the sleep.
- **`/cpu`:** the recursion never yields, so it blocks every other greenlet in its worker while it
  computes.
