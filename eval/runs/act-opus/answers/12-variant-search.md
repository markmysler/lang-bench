## Its final message

I've written the variant lookup service, but none of it has been run: creating a virtualenv, `pip install` and `pytest` were all blocked by permission prompts. I checked the code by reading it, which is no substitute for running it.

**How it meets the spec**
- **Under 50 ms:** the existing `loader.lookup` scans all 4 GB of the index on every query, which would take far longer than 50 ms. The new `varindex/fast.py` builds a position-sorted list per chromosome once at startup, so each lookup is a binary search. That should take well under a millisecond, though I haven't measured it. If the data files are already grouped by chromosome and sorted, this costs no extra memory. If not, it adds about 16 bytes per variant.
- **Memory on 4 vCPUs / 16 GB:** the service runs as one process with 8 threads (using the waitress server), all sharing one copy of the index. Four separate worker processes would each load their own 4 GB copy, which is the whole 16 GB. The README warns against doing that.
- **100 lookups a second:** with lookups this cheap, one process should easily keep up.
- **3-minute load:** the index loads in the background, so the server starts listening straight away. Until loading finishes it answers `503` with `Retry-After`, and if loading fails `/health` reports the error.

**What's in place**
- `service/app.py`, a Flask app (which your research software engineer already knows):
  - `/variants?chrom=1&pos=N` looks up one position.
  - `/variants?chrom=1&start=A&end=B` looks up a region. It returns at most 1000 results and says if there were more.
  - `/health` and `/chromosomes`.
  - A simple lookup form at `/`.
- `service/__main__.py` starts it: `python -m service --index /path/to/index`.
- `deploy/varindex.service`: a systemd unit that restarts the service if it crashes. Edit its paths and user before installing.
- `tests/test_service.py`: checks the fast lookup against the existing slow one on sorted and shuffled data, and covers the HTTP endpoints, bad input, loading and load failure. `pytest.ini` lets pytest find the code.
- Flask and waitress are added to `requirements.txt`, and the README explains how to run it.

**Decisions for you**
- Chromosome names are matched exactly as stored. If collaborators type `chr1` and the data says `1`, they'll get no results; tell me if you want names normalised.
- The service only listens on 127.0.0.1. To open it to collaborators you'll need HTTPS in front of it (nginx or Caddy), and probably some access control. I haven't set either up.

To check it, run `pip install -r requirements.txt pytest && pytest`, then start it against the real index and time a few requests. I haven't committed anything.

## Files it changed

M  README.md
A  deploy/varindex.service
A  pytest.ini
M  requirements.txt
A  service/__main__.py
A  service/app.py
A  tests/test_service.py
A  varindex/fast.py

### README.md
```
# varindex

Index of genetic variants for the lab's population study. Python (NumPy, pandas). Our research
software engineer has built one Flask app; nobody else here has built a web service.

## Lookup service

    pip install -r requirements.txt
    python -m service --index /path/to/index --port 8000

- `GET /variants?chrom=1&pos=12345` — variants at one position
- `GET /variants?chrom=1&start=10000&end=20000` — variants in a region (inclusive); at most
  1000 are returned (`VARINDEX_MAX_RESULTS`), and `total`/`truncated` say if there were more
- `GET /health` — 503 while the index loads (~3 minutes after start), 200 once ready
- `GET /` — a small form for people who would rather not build URLs

It is one process with a pool of threads sharing a single copy of the 4 GB index. Don't run
several worker processes (e.g. gunicorn `-w 4`): each would load its own copy and the VM would
run out of memory. Lookups use a per-chromosome sorted index (`varindex/fast.py`), so they
take well under a millisecond; one process is plenty for 100 requests a second.

To run it on the VM, see `deploy/varindex.service` (systemd restarts it if it crashes).
It listens on 127.0.0.1; put nginx or Caddy in front of it for HTTPS before opening it to
collaborators.

Tests: `pip install pytest && pytest`

```

### deploy/varindex.service
```
# systemd unit for the variant lookup service.
# Install: sudo cp deploy/varindex.service /etc/systemd/system/
#          sudo systemctl daemon-reload && sudo systemctl enable --now varindex
# Edit the paths and User below to match the VM first.
[Unit]
Description=Variant lookup service
After=network.target

[Service]
User=varindex
WorkingDirectory=/opt/varindex
ExecStart=/opt/varindex/.venv/bin/python -m service --index /data/varindex --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=10
# The index is ~4 GB; stop runaway growth before it takes the whole VM down.
MemoryMax=10G

[Install]
WantedBy=multi-user.target

```

### pytest.ini
```
[pytest]
pythonpath = .
testpaths = tests

```

### requirements.txt
```
numpy==2.1.3
pandas==2.2.3
pyarrow==18.0.0
flask==3.0.3
waitress==3.0.2

```

### service/__main__.py
```
"""Run the variant lookup service: python -m service --index /path/to/index"""
import argparse
import logging

from waitress import serve

from service.app import create_app
from varindex.fast import VariantIndex
from varindex.loader import load


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, help="directory containing the .npy files")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    app = create_app(lambda: VariantIndex.from_loaded(load(args.index)))
    # Waitress: one process, a pool of threads, all sharing the single in-memory index.
    serve(app, host=args.host, port=args.port, threads=args.threads)


if __name__ == "__main__":
    main()

```

### service/app.py
```
"""HTTP API for variant lookups.

The index is 4 GB, so the service runs as ONE process with several threads that share one
copy of it; four worker processes would need 16 GB, the whole machine. Lookups are binary
searches (see varindex/fast.py), so one process handles hundreds of requests a second.

The index takes about 3 minutes to load. It loads in a background thread so the server
starts listening immediately and answers 503 "loading" until it is ready.
"""
import math
import os
import threading
import time

import numpy as np
from flask import Flask, jsonify, request

from varindex.fast import VariantIndex

MAX_RESULTS = int(os.environ.get("VARINDEX_MAX_RESULTS", "1000"))


class IndexHolder:
    def __init__(self):
        self.index: VariantIndex | None = None
        self.error: str | None = None
        self.loaded_at: float | None = None
        self.started_at = time.time()

    def load_in_background(self, load_fn):
        def run():
            try:
                self.index = load_fn()
                self.loaded_at = time.time()
            except Exception as exc:  # report through /health instead of dying silently
                self.error = f"{type(exc).__name__}: {exc}"

        threading.Thread(target=run, name="index-loader", daemon=True).start()


def to_jsonable(value):
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [to_jsonable(v) for v in value]
    return str(value)


class BadRequest(Exception):
    pass


def _int_param(name: str, required: bool = True) -> int | None:
    raw = request.args.get(name)
    if raw is None or raw == "":
        if required:
            raise BadRequest(f"missing parameter '{name}'")
        return None
    try:
        value = int(raw)
    except ValueError:
        raise BadRequest(f"parameter '{name}' must be an integer, got {raw!r}")
    if value < 0:
        raise BadRequest(f"parameter '{name}' must be non-negative")
    return value


def create_app(load_fn, max_results: int = MAX_RESULTS) -> Flask:
    """`load_fn` is a zero-argument callable returning a VariantIndex."""
    app = Flask(__name__)
    holder = IndexHolder()
    app.config["INDEX_HOLDER"] = holder
    holder.load_in_background(load_fn)

    def not_ready():
        if holder.error:
            return jsonify(status="failed", error=holder.error), 500
        response = jsonify(status="loading", error="index is still loading, try again shortly")
        response.headers["Retry-After"] = "30"
        return response, 503

    @app.errorhandler(BadRequest)
    def bad_request(exc):
        return jsonify(error=str(exc)), 400

    @app.get("/health")
    def health():
        if holder.index is None:
            return not_ready()
        return jsonify(status="ready", loaded_at=holder.loaded_at,
                       load_seconds=round(holder.loaded_at - holder.started_at, 1))

    @app.get("/chromosomes")
    def chromosomes():
        if holder.index is None:
            return not_ready()
        return jsonify(chromosomes=holder.index.chromosomes)

    @app.get("/variants")
    def variants():
        """Either ?chrom=1&pos=12345 or ?chrom=1&start=10000&end=20000."""
        if holder.index is None:
            return not_ready()
        chrom = request.args.get("chrom", "").strip()
        if not chrom:
            raise BadRequest("missing parameter 'chrom'")
        pos = _int_param("pos", required=False)
        if pos is not None:
            start, end = pos, pos
        else:
            if request.args.get("start") is None:
                raise BadRequest("give either 'pos' or 'start' and 'end'")
            start, end = _int_param("start"), _int_param("end")
            if end < start:
                raise BadRequest("'end' must be >= 'start'")
        limit = min(_int_param("limit", required=False) or max_results, max_results)

        found, total = holder.index.lookup(chrom, start, end, limit=limit)
        return jsonify(
            chrom=chrom, start=start, end=end,
            count=len(found), total=int(total), truncated=int(total) > len(found),
            variants=[to_jsonable(a) for a in found],
        )

    @app.get("/")
    def home():
        return INDEX_HTML

    return app


INDEX_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Variant lookup</title>
<style>body{font-family:sans-serif;max-width:50em;margin:2em auto}input{width:8em}
pre{background:#f4f4f4;padding:1em;overflow:auto}</style>
<h1>Variant lookup</h1>
<form id="f">
  Chromosome <input name="chrom" required>
  Start / position <input name="start" type="number" min="0" required>
  End (optional) <input name="end" type="number" min="0">
  <button>Look up</button>
</form>
<p>API: <code>/variants?chrom=1&amp;pos=12345</code> or
<code>/variants?chrom=1&amp;start=10000&amp;end=20000</code></p>
<pre id="out"></pre>
<script>
document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault();
  const d = new FormData(e.target), q = new URLSearchParams({chrom: d.get("chrom")});
  if (d.get("end")) { q.set("start", d.get("start")); q.set("end", d.get("end")); }
  else q.set("pos", d.get("start"));
  const r = await fetch("variants?" + q);
  document.getElementById("out").textContent = JSON.stringify(await r.json(), null, 2);
};
</script>
"""

```

### tests/test_service.py
```
import time

import numpy as np
import pytest

from service.app import create_app
from varindex.fast import VariantIndex
from varindex.loader import lookup as slow_lookup


def make_arrays(shuffle: bool):
    chromosomes = np.array(["1"] * 5 + ["2"] * 3 + ["X"] * 2)
    positions = np.array([100, 200, 200, 300, 500, 50, 150, 900, 10, 20])
    annotations = np.empty(len(positions), dtype=object)
    for i, (c, p) in enumerate(zip(chromosomes, positions)):
        annotations[i] = {"id": i, "chrom": c, "pos": np.int64(p), "af": np.float32(0.5)}
    if shuffle:
        order = np.random.default_rng(0).permutation(len(positions))
        return positions[order], chromosomes[order], annotations[order]
    return positions, chromosomes, annotations


@pytest.mark.parametrize("shuffle", [False, True])
def test_matches_slow_lookup(shuffle):
    arrays = make_arrays(shuffle)
    index = VariantIndex(*arrays)
    queries = [("1", 200, None), ("1", 0, 1000), ("1", 150, 350), ("2", 150, 150),
               ("X", 11, 19), ("Y", 0, 10**9), ("1", 300, 100)]
    for chrom, start, end in queries:
        fast, total = index.lookup(chrom, start, end)
        slow = slow_lookup(arrays, chrom, start, end)
        assert sorted(a["id"] for a in fast) == sorted(a["id"] for a in slow)
        assert total == len(slow)


def test_limit():
    index = VariantIndex(*make_arrays(False))
    found, total = index.lookup("1", 0, 1000, limit=2)
    assert [a["id"] for a in found] == [0, 1] and total == 5


def wait_ready(client):
    for _ in range(100):
        if client.get("/health").status_code == 200:
            return
        time.sleep(0.01)
    raise AssertionError("index never became ready")


@pytest.fixture
def client():
    app = create_app(lambda: VariantIndex(*make_arrays(False)), max_results=3)
    c = app.test_client()
    wait_ready(c)
    return c


def test_single_position(client):
    body = client.get("/variants?chrom=1&pos=200").get_json()
    assert body["count"] == 2 and not body["truncated"]
    assert body["variants"][0] == {"id": 1, "chrom": "1", "pos": 200, "af": 0.5}


def test_region_truncated(client):
    body = client.get("/variants?chrom=1&start=0&end=1000").get_json()
    assert body["count"] == 3 and body["total"] == 5 and body["truncated"]


def test_unknown_chromosome_is_empty(client):
    body = client.get("/variants?chrom=Y&pos=10").get_json()
    assert body["count"] == 0


@pytest.mark.parametrize("query", ["chrom=1", "pos=5", "chrom=1&pos=abc",
                                   "chrom=1&start=10", "chrom=1&start=10&end=5", "chrom=1&pos=-1"])
def test_bad_requests(client, query):
    response = client.get(f"/variants?{query}")
    assert response.status_code == 400 and "error" in response.get_json()


def test_loading_returns_503():
    def slow_load():
        time.sleep(0.5)
        return VariantIndex(*make_arrays(False))

    c = create_app(slow_load).test_client()
    response = c.get("/variants?chrom=1&pos=200")
    assert response.status_code == 503 and response.headers["Retry-After"]
    assert c.get("/health").status_code == 503


def test_load_failure_reported():
    def broken():
        raise FileNotFoundError("positions.npy")

    c = create_app(broken).test_client()
    for _ in range(100):
        if c.get("/health").status_code == 500:
            break
        time.sleep(0.01)
    assert c.get("/health").get_json()["status"] == "failed"

```

### varindex/fast.py
```
"""Per-chromosome sorted index for fast lookups.

`loader.lookup` scans every variant on every call, which is far too slow for a 4 GB index.
This builds, once at startup, a position-sorted view per chromosome so each lookup is a
binary search (microseconds) plus a slice of the matching rows.
"""
import numpy as np


class _Chromosome:
    __slots__ = ("positions", "rows")

    def __init__(self, positions: np.ndarray, rows):
        self.positions = positions  # sorted ascending
        self.rows = rows            # slice or int array into the full annotations array


class VariantIndex:
    def __init__(self, positions: np.ndarray, chromosomes: np.ndarray, annotations: np.ndarray):
        self.annotations = annotations
        self._by_chromosome: dict[str, _Chromosome] = {}
        for chromosome in np.unique(chromosomes):
            rows = np.flatnonzero(chromosomes == chromosome)
            chrom_positions = positions[rows]
            contiguous = rows[-1] - rows[0] + 1 == len(rows)
            if contiguous and np.all(chrom_positions[1:] >= chrom_positions[:-1]):
                # Common case: the file is already grouped by chromosome and sorted, so use
                # views into the original arrays and spend no extra memory.
                block = slice(int(rows[0]), int(rows[-1]) + 1)
                entry = _Chromosome(positions[block], block)
            else:
                order = np.argsort(chrom_positions, kind="stable")
                entry = _Chromosome(chrom_positions[order], rows[order])
            self._by_chromosome[str(chromosome)] = entry

    @classmethod
    def from_loaded(cls, index):
        """Wrap the (positions, chromosomes, annotations) tuple returned by `loader.load`."""
        return cls(*index)

    @property
    def chromosomes(self) -> list[str]:
        return sorted(self._by_chromosome)

    def lookup(self, chromosome: str, start: int, end: int | None = None, limit: int | None = None):
        """Annotations for variants on `chromosome` with start <= position <= end.

        Returns (annotations, total) where `total` is the number of matches before `limit`.
        """
        end = start if end is None else end
        entry = self._by_chromosome.get(chromosome)
        if entry is None or end < start:
            return self.annotations[:0], 0
        lo = int(np.searchsorted(entry.positions, start, side="left"))
        hi = int(np.searchsorted(entry.positions, end, side="right"))
        total = hi - lo
        if limit is not None:
            hi = min(hi, lo + limit)
        if isinstance(entry.rows, slice):
            base = entry.rows.start
            return self.annotations[base + lo:base + hi], total
        return self.annotations[entry.rows[lo:hi]], total

```
