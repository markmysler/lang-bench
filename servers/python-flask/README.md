# Python + Flask (gunicorn sync workers)

One of three Flask servers with identical `app.py` that differ only in the gunicorn worker type:
`python-flask` (sync), `python-flask-gthread` (threads) and `python-flask-gevent` (greenlets).

- **Server:** Flask 3.1 on gunicorn 26.2 with the default `sync` worker, CPython 3.14 in
  `python:3.14.10-slim-trixie`. No access log; errors go to stderr. Flask runs with its
  production defaults (`jsonify` sorts keys and ends the body with a newline).
- **Concurrency:** `2 x CPUS + 1` worker processes, gunicorn's documented starting point. Each
  process handles one request at a time; the extra processes keep the cores busy while others
  wait on I/O. Sync workers do not support keep-alive: gunicorn answers with
  `Connection: close` and the client reconnects for every request. This is how the sync worker
  behaves in production and it penalises this server, most visibly on `/plaintext` and `/json`.
- **Database:** psycopg 3 with a `psycopg_pool.ConnectionPool` in each worker of
  `max(1, floor(DB_POOL / workers))` connections (a sync worker only ever uses one). The pool
  has `min_size=0` and connects on first use, so the server starts without a database. Statements
  are prepared on first use on each connection (`prepare_threshold=0`) and run in autocommit
  mode. psycopg is used in all three Flask servers so only the concurrency model differs.
- **`/io`:** `time.sleep`, which blocks the whole worker process for the wait, so at most
  `2 x CPUS + 1` waits are held at once. The deadline is re-checked after the sleep.
- **`/cpu`:** the recursion runs in the request, as in any sync Python server.
