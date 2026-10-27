## Its final message

I built the lookup service, but I could not run anything. The shell rejected `python`, `pip`, and `pytest` calls that needed approval, so the code and tests are checked by reading only. Nothing is committed.

**What's in place**
- `varindex/service.py`: a Flask app. `create_app()` loads the index once at startup and serves:
  - `GET /lookup?chromosome=1&start=12345` for one variant, or add `&end=12400` for a region.
  - `GET /health` for the variant count.
- The existing loader's `lookup` scans the full 4 GB array for every query, which would blow the 50 ms budget. The service instead records each chromosome's row range once at startup, then answers each query with two binary searches inside that range.
- `tests/test_service.py`: tests on a small synthetic index covering single, region, empty and unknown-chromosome lookups, bad requests, the result cap, and rejection of unsorted or split-chromosome indexes.
- `requirements.txt` gains `flask` and `gunicorn`; `README.md` has a short run section.

**Decisions I made that you should check**
- **Index layout assumption:** each chromosome must be one contiguous block with positions sorted inside it. The loader's comment doesn't say this, so the service checks it at startup and refuses to start otherwise. If the real index doesn't meet this, it needs re-sorting, or the service needs a different approach.
- **Single worker with threads** (`gunicorn -w 1 --threads 8`). The annotations are Python objects, so forked workers would each copy-on-write their share of the 4 GB.
- **Result cap:** regions returning more than 10,000 variants get a 400 asking for a narrower region. This is my number, not from the spec.
- **No authentication.** The spec doesn't mention it, but if the VM is reachable beyond the lab, anyone can query it.
- **`allow_pickle=True` in the loader:** the annotations are unpickled on load, so the index files must come from a trusted source.

**Not verified**
- Tests have not been run. `pytest` isn't in `requirements.txt`, so install it first (`python -m pytest tests`).
- The 50 ms and 100 requests/second targets are unmeasured. The 3-minute load and 4 GB footprint are from the spec, not tested.

## Files it changed

M  README.md
M  requirements.txt
A  tests/test_service.py
A  varindex/service.py

### README.md
```
# varindex

Index of genetic variants for the lab's population study. Python (NumPy, pandas). Our research
software engineer has built one Flask app; nobody else here has built a web service.

## Variant lookup service

Serves lookups over HTTP (see `docs/service.md`). The index takes about 3 minutes to load, so it loads once at startup.

    VARINDEX_PATH=/path/to/index gunicorn -w 1 --threads 8 "varindex.service:create_app()"

- `GET /lookup?chromosome=1&start=12345` returns one variant; add `&end=12400` for a region.
- `GET /health` returns the variant count once the index has loaded.

Tests: `python -m pytest tests`

```

### requirements.txt
```
numpy==2.1.3
pandas==2.2.3
pyarrow==18.0.0
flask==3.1.0
gunicorn==23.0.0

```

### tests/test_service.py
```
import numpy as np
import pytest

from varindex import service


@pytest.fixture
def index_dir(tmp_path):
    np.save(tmp_path / "positions.npy", np.array([10, 20, 30, 5, 15, 25], dtype=np.int64))
    np.save(tmp_path / "chromosomes.npy", np.array(["1", "1", "1", "2", "2", "2"]))
    np.save(tmp_path / "annotations.npy", np.array(["a", "b", "c", "d", "e", "f"], dtype=object))
    return tmp_path


@pytest.fixture
def client(index_dir):
    return service.create_app(str(index_dir)).test_client()


def test_single_variant(client):
    response = client.get("/lookup?chromosome=1&start=20")
    assert response.status_code == 200
    assert response.get_json()["annotations"] == ["b"]


def test_region(client):
    response = client.get("/lookup?chromosome=1&start=15&end=30")
    assert response.get_json()["annotations"] == ["b", "c"]


def test_region_on_second_chromosome(client):
    response = client.get("/lookup?chromosome=2&start=10&end=25")
    assert response.get_json()["annotations"] == ["e", "f"]


def test_no_variants_in_region(client):
    response = client.get("/lookup?chromosome=1&start=11&end=19")
    assert response.status_code == 200
    assert response.get_json()["annotations"] == []


def test_unknown_chromosome(client):
    response = client.get("/lookup?chromosome=3&start=1&end=100")
    assert response.status_code == 200
    assert response.get_json()["annotations"] == []


def test_bad_requests(client):
    assert client.get("/lookup?chromosome=1").status_code == 400
    assert client.get("/lookup?chromosome=1&start=x").status_code == 400
    assert client.get("/lookup?start=10").status_code == 400
    assert client.get("/lookup?chromosome=1&start=30&end=10").status_code == 400


def test_too_many_results(index_dir, monkeypatch):
    monkeypatch.setattr(service, "MAX_RESULTS", 1)
    client = service.create_app(str(index_dir)).test_client()
    assert client.get("/lookup?chromosome=1&start=1&end=100").status_code == 400


def test_health(client):
    response = client.get("/health")
    assert response.get_json() == {"status": "ok", "variants": 6}


def test_unsorted_positions_rejected():
    positions = np.array([10, 30, 20])
    chromosomes = np.array(["1", "1", "1"])
    with pytest.raises(ValueError, match="not sorted"):
        service.build_index(positions, chromosomes, np.array(["a", "b", "c"], dtype=object))


def test_split_chromosome_rejected():
    positions = np.array([10, 20, 30])
    chromosomes = np.array(["1", "2", "1"])
    with pytest.raises(ValueError, match="contiguous"):
        service.build_index(positions, chromosomes, np.array(["a", "b", "c"], dtype=object))

```

### varindex/service.py
```
"""Variant lookup web service.

Loads the index into memory once at startup, then answers each lookup with two
binary searches inside one chromosome, so a lookup never scans the whole index.

Run it with one worker and several threads. The annotations are Python objects,
so forked workers would each copy-on-write their own share of them:

    VARINDEX_PATH=/path/to/index gunicorn -w 1 --threads 8 "varindex.service:create_app()"
"""
import os
from dataclasses import dataclass

import numpy as np
from flask import Flask, abort, request

from varindex.loader import load

MAX_RESULTS = 10_000


@dataclass
class Index:
    positions: np.ndarray
    annotations: np.ndarray
    bounds: dict  # chromosome -> (first row, end row), end exclusive


def build_index(positions, chromosomes, annotations):
    """Record where each chromosome's rows sit in the index.

    Binary search is only correct when each chromosome is one contiguous block
    with positions sorted inside it, so anything else raises instead of
    answering wrongly.
    """
    n = len(chromosomes)
    if n == 0:
        return Index(positions, annotations, {})
    edges = np.concatenate(([0], np.flatnonzero(chromosomes[1:] != chromosomes[:-1]) + 1, [n]))
    bounds = {}
    for lo, hi in zip(edges[:-1], edges[1:]):
        lo, hi = int(lo), int(hi)
        chrom = str(chromosomes[lo])
        if chrom in bounds:
            raise ValueError(f"chromosome {chrom} is not one contiguous block in the index")
        if np.any(positions[lo + 1:hi] < positions[lo:hi - 1]):
            raise ValueError(f"positions for chromosome {chrom} are not sorted in the index")
        bounds[chrom] = (lo, hi)
    return Index(positions, annotations, bounds)


def lookup_range(index, chromosome, start, end):
    """Annotations for positions start..end (inclusive) on one chromosome."""
    if chromosome not in index.bounds:
        return index.annotations[:0]
    lo, hi = index.bounds[chromosome]
    block = index.positions[lo:hi]
    first = lo + np.searchsorted(block, start, side="left")
    last = lo + np.searchsorted(block, end, side="right")
    return index.annotations[first:last]


def create_app(path=None):
    index = build_index(*load(path or os.environ["VARINDEX_PATH"]))
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return {"status": "ok", "variants": len(index.positions)}

    @app.get("/lookup")
    def lookup():
        # One variant: chromosome and start. A region: chromosome, start and end.
        chromosome = request.args.get("chromosome", "")
        try:
            start = int(request.args["start"])
            end = int(request.args.get("end", start))
        except (KeyError, ValueError):
            abort(400, "start is required; start and end must be integers")
        if not chromosome or end < start:
            abort(400, "chromosome is required, and end must not be before start")
        hits = lookup_range(index, chromosome, start, end)
        if len(hits) > MAX_RESULTS:
            abort(400, f"more than {MAX_RESULTS} variants in that region; narrow it")
        return {
            "chromosome": chromosome,
            "start": start,
            "end": end,
            "annotations": hits.tolist(),
        }

    return app

```
