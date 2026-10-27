# Recommendation: keep the service in Python, change how the index is stored

**What I'd use:** a thin Python web layer (FastAPI or Flask under gunicorn) in front of an index stored in a format that can be queried straight from disk. Build that format in a batch job. C++ would only be a fallback.

## Why the language isn't the problem

- 100 lookups/s with a 50 ms budget is a modest load. If a lookup costs about 1 ms, one core handles roughly 1,000/s, and you have 4 cores.
- The real problems are the 3-minute load and the 4 GB footprint. They suggest the index is built in Python memory at startup, perhaps by unpickling or parsing text. A C++ rewrite would not fix that unless you also changed the storage format. If you changed the format, you'd mostly not need C++.
- **Memory is the real constraint.** A web server runs several worker processes for parallelism. If each loads its own 4 GB copy, four workers use all 16 GB. A memory-mapped file is held once in the OS page cache and shared by every worker. Startup becomes close to instant, and a restart or crash costs seconds, not 3 minutes.

## Storage options, in the order I'd evaluate them

1. **Sorted, fixed-width binary arrays with NumPy `memmap`.** Sort by chromosome and position. A single-variant lookup is a binary search. A region query is two binary searches and a contiguous slice. This is fastest and fits your skills, but you own the format and its documentation.
2. **SQLite with an index on (chrom, pos).** It's a single file, needs no server, and is very well understood. Lookups are typically sub-millisecond once the file is in the page cache. It adds the least maintenance and is my default if the data is tabular.
3. **bgzip plus tabix (via pysam).** This is the genomics standard for region queries. It's a good fit if your data is already VCF-like and collaborators already know the format.
4. **DuckDB or Parquet.** These are excellent for analytics but not tuned for many tiny point lookups. I'd skip them here.

I'd try option 2 first, with option 1 as the upgrade if it's too slow. Both can be benchmarked in a day or two.

## Alternatives considered

- **C++ service (e.g. with a custom HTTP layer):** fastest at runtime, but the lab has little web-service experience, and you'd be taking on memory safety, a build chain, HTTP handling and a bus-factor of one. That cost lands exactly where you said you have the least time.
- **Keep the current script, just add Flask:** it fails on the 3-minute restarts and on memory per worker. Running one process with threads would work if lookups are fast, but the GIL and any slow region query will block everyone.
- **C++ or Rust only for the hot loop, called from Python:** reasonable if profiling shows the lookup itself is slow. I'd defer it until you have a number.
- **A full database server (Postgres):** it works but adds an operational burden for a 4 GB read-only dataset.

## Risks

- **Region queries are the latency risk.** A point lookup is trivial. A region returning 500,000 variants will not take 50 ms, because serialising JSON dominates. You'll need a cap on region size or result count, plus pagination or a download route for large ones.
- **Tail latency after a cold start.** The first queries after a restart read from disk. Warm the file by reading it once at startup.
- **Traffic spikes when a paper comes out.** Rate-limit per IP, and cache popular lookups in a small LRU. Check that the VM is allowed to be public and who handles security patching.
- **Reproducibility.** Treat the index as a versioned, immutable artifact. Build it on the cluster with a pinned script, record a checksum, and return the index version in every response. Updating means swapping in a new file and reloading workers, not editing in place.
- **Bus factor.** The research software engineer is the only person with web experience. Keep the service small enough (one file, one config, one deploy script) that someone else can restart or redeploy it.

## What I'd check before committing

1. **What the index actually is.** Is it keyed by position, by ID, or both? Does it hold interval data? Do the variants have a variable-length payload? This decides between the options above. I've assumed it's a sorted table of variants and annotations, and the advice changes if it's something else, such as a trie or a model.
2. **Where the 3 minutes goes.** Profile the load. If it's parsing text, a binary format fixes it. If it's building a data structure, you'll want to know that before choosing storage.
3. **Query shapes.** How big are typical regions, and what's the largest you must support? What does a result look like, and how big is it in bytes?
4. **Update frequency.** Is it fixed per paper, or monthly? That determines whether "rebuild and swap" is enough.
5. **A realistic load test.** Replay a mix of point and region lookups at 100+/s against a prototype on the actual VM, and look at p99 latency, not the average.
6. **The VM's constraints.** Check disk speed, whether the university allows an outward-facing service, and who backs it up.

The first prototype would be a SQLite file built on the cluster, a ~50-line service, and a load test. That takes about a week of one person's time. If it meets the target, you're done and you have a small thing to maintain. If not, you'll know which part is slow, and C++ or the memmap route can be aimed at that specific piece.
