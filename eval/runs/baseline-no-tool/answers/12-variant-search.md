# Variant lookup service: recommendation

## Short answer

Build it in Python, the language your lab already knows. Nothing about this service needs C++. The slow part is not Python. The slow part is that the index gets rebuilt every time the script starts. Fix how the index is stored and served, and the language stops mattering.

## Why Python is fast enough

- **The 3 minutes is a startup cost, not a per-lookup cost.** A web service loads its data once and then answers requests for weeks. Users never wait for that load.
- **A lookup on a sorted, in-memory index is tiny work.** Finding one variant or a region is a binary search, which takes microseconds in NumPy. The 50 ms budget will mostly go on network time and turning results into JSON, not on the search.
- **100 lookups a second is a light load.** One Python process doing sub-millisecond work can handle several times that.

## What I'd build

1. **Save the index in a format that opens in seconds and can be shared between processes.** Don't keep rebuilding Python objects at startup. Which format depends on what the index looks like inside:
   - **Mostly numeric arrays** (chromosome, position, IDs, scores): sort them per chromosome and save them as `.npy` files. Open them with `np.load(..., mmap_mode="r")`. Opening is nearly instant. The operating system keeps the data in its file cache, so several worker processes share one 4 GB copy instead of holding four. Use `np.searchsorted` for both single-variant and region lookups.
   - **Lots of variable-length strings** (REF/ALT alleles for indels, annotations): use SQLite with an index on (chromosome, position). It's a single file, needs no server, handles strings natively, and point and range lookups take well under a millisecond. Collaborators can also open it directly from Python, R or the command line.
2. **Build the index as a batch job on the HPC cluster** and copy the finished file to the VM. Give each build a version number or checksum, and include it in every API response and on an `/about` page. That way any result can be traced back to the exact index it came from.
3. **Write a thin web layer with Flask** (your engineer already knows it) or FastAPI. FastAPI's advantages are automatic input checking and auto-generated API docs, which help collaborators. Run it under gunicorn with about 4 workers, behind nginx or Caddy for HTTPS, with systemd restarting it if it crashes. This setup is standard and needs little upkeep.
4. **Limit region queries.** Set a maximum region size or number of results, and paginate or offer a downloadable file beyond that. A request covering a whole chromosome is what would break the 50 ms target, not ordinary lookups.

If profiling ever shows a real hot spot, write that one function in C++ with pybind11, as you already do for your hot loops. Keep the web service itself in Python.

## Alternatives I considered

- **Rewrite the service in C++, Rust or Go.** It would be fast, but no faster in any way users would notice, because the lookup is already microseconds. Your team has little web experience, and a web service in C++ is much more to maintain between grants. You'd pay that cost for no gain.
- **Keep today's approach (load into Python objects) and serve it.** This works with one process. With several gunicorn workers, each one loads its own 4 GB, so 4 workers would fill all 16 GB and the VM would run out of memory. Restarting would also cost 3 minutes of downtime. It's fine for a demo, not for a service.
- **bgzip + tabix files read with pysam.** This is a strong option if the index is basically a sorted table of variants. It uses no memory, starts instantly, and region queries take a few milliseconds from disk. It's also the standard format in genomics, so collaborators can download the file and use it offline with `tabix` or `bcftools`. I'd offer a tabix file as a download whatever you choose for the service. It's weaker if lookups need joins or complex filters.
- **Redis, Postgres or Elasticsearch.** Each adds another service to run, secure and upgrade, and you don't need what they offer.
- **DuckDB or Parquet.** Excellent for analysis, but tuned for scanning large amounts of data rather than fast single lookups. SQLite is the better fit here.

## Risks

- **Memory use with several workers.** This is the main technical trap. Choosing memory-mapped arrays or SQLite avoids it.
- **Large region responses.** Turning 100,000 variants into JSON will take far longer than 50 ms. Limit them, as in step 4.
- **Slow first queries after a restart.** With memory mapping, the data is read from disk the first time it's touched. If the VM's disk is slow network storage, early queries may be slow. You can read the file once at startup to fix this.
- **Fragile file format.** If the current index is a pickle file, it can break across Python or NumPy versions, which is a reproducibility problem. `.npy`, SQLite and tabix are stable, documented formats.
- **Exposing a public endpoint.** Validate region strings strictly, cap request sizes, and add simple per-client rate limiting at the proxy so one person scraping can't crowd out everyone else. Check the university IT department's rules on public VMs and HTTPS certificates early, because that is often the slowest step.
- **Only one person knows how it works.** Keep it boring: one repository, a locked environment (uv or conda-lock), a short README covering how to rebuild the index, deploy, and roll back.

## What I'd check before committing (about a day of work)

1. **Time the lookups in the existing script once it has loaded.** In a notebook, run 10,000 random single-variant and region lookups. If they take microseconds to around a millisecond, the language question is settled. Also find out where the 3 minutes goes (parsing text, unpickling, building dicts). That tells you how easy the conversion will be.
2. **Look at what the index contains:** numeric arrays or strings and nested objects. That decides between `.npy` + memory mapping and SQLite.
3. **Find the largest region anyone will reasonably ask for** and how many results it returns. Set the limit from that.
4. **Check the VM:** disk type (SSD or network storage), free disk space for the index plus the next version, and whether it can be reached from outside the university.
5. **Define where the 50 ms is measured.** Server time and the round trip from a collaborator's browser are different budgets.
6. **Decide how often the index changes.** Plan to switch versions by copying the new file in, repointing a symlink, and restarting, which takes seconds.
7. **Run a load test** on a prototype at about 3× peak (300 lookups a second) with locust or k6, with a mix of single and region queries. Look at the 99th-percentile latency, not the average.

If check 1 comes back in microseconds, which I expect, build it in Python with whichever storage format check 2 points to.
