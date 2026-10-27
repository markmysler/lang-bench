## Recommendation

**Keep Python.** Serve the index from a read-only file on the VM's local disk that the OS can cache, and put a small Flask app in front of it. Don't load the index into Python objects at startup. The 3-minute load is a storage-format problem, not a language problem, and C++ would not fix it.

Concretely:

- **Build the index once, on the HPC cluster,** into a single file. I'd use **SQLite** with a primary key on (chromosome, position, ref, alt) and an index on rsID. Single-variant lookups and region scans are both B-tree operations, and SQLite handles both well.
- **Copy the file to the VM's local disk** (not a network share) and open it read-only. Startup becomes effectively instant.
- **Run the app under gunicorn with about 4 workers, behind nginx.** Each worker opens the same file, so the OS page cache holds one copy of the hot pages, shared across workers. After warm-up, most lookups should be served from RAM at sub-millisecond to low-millisecond cost.
- **Version the file.** Ship a checksum and an index version in every response, and keep the build script in the lab's repo. This gives you the reproducibility you care about and lets collaborators use the same artifact.

If the index is mostly region queries over VCF-like data, **tabix** (bgzipped and indexed, queried through pysam) is the genomics community's standard and is also a good choice. Its weak spot is lookup by rsID, which needs extra work. SQLite covers both cases in one file.

## Alternatives considered

- **Full C++ service** (Drogon, Crow, cpp-httplib, plus a custom index): the lookup would be fast, but you'd own the HTTP layer, JSON, build and packaging, and security updates in C++. That is a lot of upkeep for one RSE with little web experience and little time between grants. Python's per-request overhead is small compared with the 50 ms budget, so C++ doesn't buy you much here. Revisit it only if profiling shows the lookup code or serialization is the bottleneck, and then use C++ as an extension behind the Python web layer, not as a web server.
- **Python dict or object index loaded per process:** this is the current approach, and it's the main risk. Python object overhead can make a 4 GB file take well over 10 GB in RAM. Four workers each holding a copy would exhaust a 16 GB VM. If the data is purely numeric, a NumPy memory-mapped array with binary search gets close to C speed without any server-side C++.
- **Redis or Memcached holding the index:** it works, but it duplicates the 4 GB in a second service you have to run, and it's a poor fit for region queries.
- **PostgreSQL:** a solid option, and it's a standard service that IT may already support. Point and range lookups on a B-tree are fast when cached. I'd pick it over SQLite if you need concurrent writers, joins with annotation tables, or a DB the university already backs up. Otherwise it's more to operate.
- **Serverless functions:** rejected. Each cold start would reload the index.

## Risks

- **Large region queries.** The 100 lookups/second target is only easy if most lookups are small. A region covering millions of variants can make response size and JSON encoding dominate. Cap results, paginate, and return a "truncated" flag.
- **Cold cache.** After a reboot, the first queries hit disk. Warm the cache at startup with a few representative queries, or read the file sequentially, and measure how long that takes.
- **Memory accounting.** Confirm that workers share the file's pages and don't each copy the data. Watch RSS and page cache under load.
- **Burst traffic at paper release.** Many users will request the same variants. Put nginx caching or a small in-app LRU in front, and rate-limit per client.
- **Sensitive data.** If the index includes human genetic data, check the data-use terms and whether the service needs authentication, access logging, or an ethics or IRB sign-off before it goes public.
- **Operations.** A single VM is a single point of failure. Someone has to own TLS, OS and dependency patching, monitoring, and restarts. Write a one-page runbook.
- **Bus factor.** Keep the stack to what the RSE already knows (Flask, gunicorn, nginx) and document the deploy.

## What I'd check before committing

1. **Profile the 3-minute load.** Find out what fraction is parsing, building structures, or unpickling, and how big the index is in RAM versus on disk. This tells you whether a format change alone fixes it.
2. **Prototype on the VM.** Convert the index to SQLite (and tabix, if you want to compare). Time open, cold and warm point lookups, and a region query of realistic size. You want server-side p99 well under 50 ms, ideally under 10–20 ms, to leave headroom.
3. **Load-test the real stack.** Run 100 requests/second for about 10 minutes with a realistic query mix (including the largest plausible regions) and 4 gunicorn workers. Watch p99, memory, and page cache.
4. **Check the VM.** Confirm the disk is local SSD, not network storage, and that 4 GB of index plus the OS and workers fit comfortably in 16 GB.
5. **Talk to university IT** about public exposure, TLS, DNS, authentication, backups, and who is on call.
6. **Pin down the query mix.** Are the "100 lookups" mostly single variants or large regions? The answer changes the design more than the language choice does.
7. **Decide who owns operations** and where the runbook lives before launch.

I haven't seen the current script or the index format, so these recommendations rest on your description. If the profile in step 1 shows something unexpected, such as the index being stored as many small files, tell me and I'll revisit the design.
