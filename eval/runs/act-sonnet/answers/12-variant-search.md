## Its final message

I've built the service, but I couldn't run it or test it. The shell blocked my test command and asked for approval, so none of this code has been executed.

**What's in place**
- **`varindex/service.py`:** a Flask app served by waitress as a single process. A single process matters because the 4 GB index would otherwise be duplicated per worker. I also added an empty `varindex/__init__.py` so it imports as a package.
- **Endpoints:**
  - `GET /variant?chrom=&pos=`
  - `GET /region?chrom=&start=&end=`
  - `GET /healthz`, which returns 503 while the index loads and 500 if the load failed.
- **Run it:** `VARINDEX_PATH=/data/index python -m varindex.service`. The server starts straight away and loads the index in a background thread. Lookups return 503 for the ~3 minutes the load takes.
- **Dependencies:** I added `flask` and `waitress` to `requirements.txt`.

**Why it should meet the 50 ms target:** the existing `lookup()` in `varindex/loader.py` scans every variant on each call. At startup the service instead splits the index per chromosome, sorting positions if they aren't already sorted. Each lookup is then a binary search.

**Choices I made**
- **Region cap:** region responses are capped at 10,000 variants. The response includes `total` and `truncated` so callers can tell.
- **Error handling:** bad parameters get a 400, and `end` less than `start` also gets a 400.
- **Annotations:** they are returned as JSON, with anything that isn't JSON-serialisable converted to a string. Check that this suits your annotation format.
- **Memory:** the per-chromosome split makes copies of the arrays, which could add up to roughly another 4 GB at load time. That should still fit in 16 GB, but I haven't confirmed it.

**Next step:** I'd run a quick check with a small synthetic index, using Flask's test client. It would cover both endpoints, an unknown chromosome and a bad parameter. Say the word and I'll try it again once the command is approved.

## Files it changed

M  requirements.txt
A  varindex/__init__.py
A  varindex/service.py

### requirements.txt
```
numpy==2.1.3
pandas==2.2.3
pyarrow==18.0.0
flask==3.1.0
waitress==3.0.2

```

### varindex/__init__.py
```

```

### varindex/service.py
```
"""HTTP lookup service. Run as ONE process: the index is ~4 GB and loading takes ~3 minutes.

    VARINDEX_PATH=/data/index python -m varindex.service

Endpoints:
    GET /variant?chrom=1&pos=12345
    GET /region?chrom=1&start=100&end=200
    GET /healthz          (503 while the index is still loading)
"""
import os
import threading

import numpy as np
from flask import Flask, jsonify, request

from varindex.loader import load

MAX_REGION_RESULTS = 10_000

app = Flask(__name__)
_state = {"index": None, "error": None}


def build_by_chromosome(index):
    """Split the flat index into per-chromosome (sorted positions, annotations) so a lookup is
    a binary search (microseconds) instead of a scan over every variant."""
    positions, chromosomes, annotations = index
    by_chrom = {}
    for chrom in np.unique(chromosomes):
        rows = np.flatnonzero(chromosomes == chrom)
        pos = positions[rows]
        if not np.all(pos[:-1] <= pos[1:]):
            order = np.argsort(pos, kind="stable")
            rows, pos = rows[order], pos[order]
        by_chrom[str(chrom)] = (pos, annotations[rows])
    return by_chrom


def query(by_chrom, chrom, start, end):
    """Return (annotations, total_matches); annotations are capped at MAX_REGION_RESULTS."""
    entry = by_chrom.get(chrom)
    if entry is None:
        return [], 0
    pos, ann = entry
    lo = int(np.searchsorted(pos, start, side="left"))
    hi = int(np.searchsorted(pos, end, side="right"))
    return ann[lo:min(hi, lo + MAX_REGION_RESULTS)], hi - lo


def _load_in_background(path):
    try:
        _state["index"] = build_by_chromosome(load(path))
    except Exception as e:  # surfaced via /healthz
        _state["error"] = repr(e)


def _to_py(x):
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x.item() if isinstance(x, np.generic) else x


def _respond(chrom, start, end):
    index = _state["index"]
    if index is None:
        return jsonify(error="index still loading"), 503
    if end < start:
        return jsonify(error="end must be >= start"), 400
    results, total = query(index, chrom, start, end)
    return jsonify(chrom=chrom, start=start, end=end, total=total,
                   truncated=total > len(results),
                   variants=[_to_py(r) for r in results])


def _int_arg(name):
    try:
        return int(request.args[name])
    except (KeyError, ValueError):
        return None


@app.get("/variant")
def variant():
    chrom, pos = request.args.get("chrom"), _int_arg("pos")
    if not chrom or pos is None:
        return jsonify(error="need chrom and integer pos"), 400
    return _respond(chrom, pos, pos)


@app.get("/region")
def region():
    chrom, start, end = request.args.get("chrom"), _int_arg("start"), _int_arg("end")
    if not chrom or start is None or end is None:
        return jsonify(error="need chrom and integer start, end"), 400
    return _respond(chrom, start, end)


@app.get("/healthz")
def healthz():
    if _state["error"]:
        return jsonify(status="failed", error=_state["error"]), 500
    if _state["index"] is None:
        return jsonify(status="loading"), 503
    return jsonify(status="ok")


app.json.default = str

if __name__ == "__main__":
    from waitress import serve

    threading.Thread(target=_load_in_background, args=(os.environ["VARINDEX_PATH"],), daemon=True).start()
    # One process: the index lives in memory once. Threads easily handle ~100 req/s bursts.
    serve(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), threads=8)

```
