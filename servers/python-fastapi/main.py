# Python + FastAPI server for lang-bench (docs/SPEC.md).
import asyncio
import os
import random
import re
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse

QUERY = "SELECT id, randomnumber FROM world WHERE id = $1"
NUMBER = re.compile(r"[+-]?[0-9]+")


def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def param(request, name, default, lo, hi):
    """Reads an integer query parameter: missing or invalid gives default, out of range is clamped."""
    value = request.query_params.get(name, "")
    if not NUMBER.fullmatch(value):
        return default
    return max(lo, min(hi, int(value)))


def env(key, default):
    try:
        n = int(os.environ.get(key, ""))
    except ValueError:
        return default
    return n if n > 0 else default


@asynccontextmanager
async def lifespan(app):
    # Runs once in every uvicorn worker process, so each worker gets its own pool and the DB_POOL
    # connections are shared out between the CPUS workers. min_size=0 means the pool connects on
    # first use, so the server starts without a database for other workloads.
    app.state.db = await asyncpg.create_pool(
        host=os.environ.get("DB_HOST"),
        port=env("DB_PORT", 5432),
        user=os.environ.get("DB_USER"),
        password=os.environ.get("DB_PASSWORD"),
        database=os.environ.get("DB_NAME"),
        min_size=0,
        max_size=max(1, env("DB_POOL", 16) // env("CPUS", 1)),
    )
    yield
    await app.state.db.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


async def random_row(db):
    # asyncpg prepares and caches the statement on each connection automatically.
    r = await db.fetchrow(QUERY, random.randint(1, 10000))
    return {"id": r["id"], "randomNumber": r["randomnumber"]}


@app.get("/health", response_class=PlainTextResponse)
async def health():
    return "ok"


@app.get("/plaintext", response_class=PlainTextResponse)
async def plaintext():
    return "Hello, World!"


@app.get("/json")
async def json():
    return {"message": "Hello, World!"}


@app.get("/cpu")
async def cpu(request: Request):
    # Computed on the event loop on purpose: this workload measures the interpreter itself.
    n = param(request, "n", 20, 0, 32)
    return {"n": n, "fib": fib(n)}


@app.get("/io")
async def io(request: Request):
    ms = param(request, "ms", 10, 0, 1000)
    await asyncio.sleep(ms / 1000)
    return {"ms": ms}


@app.get("/db")
async def db(request: Request):
    return await random_row(request.app.state.db)


@app.get("/queries")
async def queries(request: Request):
    pool = request.app.state.db
    return [await random_row(pool) for _ in range(param(request, "n", 1, 1, 500))]
