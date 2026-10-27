# Python + Flask server for lang-bench (docs/SPEC.md).
# The same file runs in python-flask, python-flask-gevent and python-flask-gthread; only the
# gunicorn worker type in gunicorn.conf.py differs. Under gevent, gunicorn monkey-patches the
# standard library before this module is imported, so time.sleep and psycopg's socket waits yield
# to other greenlets instead of blocking the worker.
import os
import random
import re
import time

from flask import Flask, Response, jsonify, request
from psycopg_pool import ConnectionPool

QUERY = "SELECT id, randomnumber FROM world WHERE id = %s"
NUMBER = re.compile(r"[+-]?[0-9]+")


def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def param(name, default, lo, hi):
    """Reads an integer query parameter: missing or invalid gives default, out of range is clamped."""
    value = request.args.get(name, "")
    if not NUMBER.fullmatch(value):
        return default
    return max(lo, min(hi, int(value)))


def env(key, default):
    try:
        n = int(os.environ.get(key, ""))
    except ValueError:
        return default
    return n if n > 0 else default


# gunicorn imports this module in every worker process after forking (no preload), so each worker
# gets its own pool. gunicorn.conf.py exports WORKERS, and DB_POOL is shared out between them.
# min_size=0 means the pool connects on first use, so the server starts without a database.
# autocommit avoids a BEGIN/COMMIT round trip around every SELECT, and prepare_threshold=0
# prepares each statement on a connection the first time it runs there.
db = ConnectionPool(
    kwargs={
        "host": os.environ.get("DB_HOST"),
        "port": env("DB_PORT", 5432),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
        "dbname": os.environ.get("DB_NAME"),
        "autocommit": True,
        "prepare_threshold": 0,
    },
    min_size=0,
    max_size=max(1, env("DB_POOL", 16) // env("WORKERS", 1)),
    open=True,
)

app = Flask(__name__)


def random_row():
    # A connection is taken from the pool for each query, as the other servers do.
    with db.connection() as conn:
        row = conn.execute(QUERY, (random.randint(1, 10000),)).fetchone()
    return {"id": row[0], "randomNumber": row[1]}


def text(body, status=200):
    return Response(body, status=status, mimetype="text/plain")


@app.get("/health")
def health():
    return text("ok")


@app.get("/plaintext")
def plaintext():
    return text("Hello, World!")


@app.get("/json")
def json():
    return jsonify(message="Hello, World!")


@app.get("/cpu")
def cpu():
    n = param("n", 20, 0, 32)
    return jsonify(n=n, fib=fib(n))


@app.get("/io")
def io():
    ms = param("ms", 10, 0, 1000)
    # time.sleep blocks only this request's thread (sync, gthread) or greenlet (gevent). The
    # deadline is re-checked so the response can never be sent early, whatever timer is used.
    end = time.monotonic() + ms / 1000
    time.sleep(ms / 1000)
    while (left := end - time.monotonic()) > 0:
        time.sleep(left)
    return jsonify(ms=ms)


@app.get("/db")
def db_one():
    try:
        return jsonify(random_row())
    except Exception as err:
        return text(str(err), 500)


@app.get("/queries")
def queries():
    n = param("n", 1, 1, 500)
    try:
        return jsonify([random_row() for _ in range(n)])
    except Exception as err:
        return text(str(err), 500)
