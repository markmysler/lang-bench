## Short answer

Keep Python for the web part. You don't need a faster language. A web request takes milliseconds, and at roughly 50 runs a day the web layer will never be the bottleneck. The 20 to 90 seconds is spent in your NumPy code, which already runs compiled C underneath. If you want the simulation faster, profile it first. The likely wins are parallelism and the C++ you already have, not the web framework.

What you need is a **job queue**. Someone submits inputs, the job waits, a worker runs the simulation, and the results are stored for download. Don't run the simulation inside the web request. The request would time out, a restart would lose the job, and a few concurrent users would tie up the server.

## What I'd use

**Phase 1 (default, self-contained on the VM):**

- **Web front end:** Flask, since the RSE already knows it. FastAPI would also work and validates input more strictly, which helps with untrusted uploads. Either is fine.
- **Queue:** a jobs table in SQLite or Postgres, with a worker process that polls it. This avoids adding Redis or Celery, which are extra services to maintain. Move to RQ with Redis only if you outgrow it.
- **Workers:** one or two systemd services on the VM. Each worker runs one job at a time. Set NumPy/BLAS to one thread per job so four cores run four jobs cleanly.
- **Packaging:** put the simulation and its pinned dependencies in an Apptainer container if the cluster already uses it. Otherwise a locked virtualenv is enough.
- **Front end behaviour:** submit, get a job ID, poll the status page, download results. Email on completion is optional.
- **Access:** university SSO if available, otherwise invited accounts with per-user quotas. Serve only over HTTPS behind the university's reverse proxy or a Let's Encrypt certificate.

**Phase 2 (if IT allows):** keep the same web app but change the worker so it submits a Slurm job to the cluster instead of running locally. The web app doesn't need to change because the queue is the boundary. This is worth doing if the cluster can accept external users, because it gives you the cluster's capacity and scheduling.

## Alternatives I considered

- **Rewrite the web part in Go, Rust or C++:** no benefit here. It adds a language to learn and maintain, and the compute time stays the same.
- **Run jobs inside Flask request handlers:** simple, but it blocks workers, hits timeouts, and loses jobs on restart. Ruled out.
- **Celery:** works well, but it's heavier than you need for this volume and has more configuration to maintain. Only worth it if you already run it.
- **Serverless (Lambda and similar):** awkward for NumPy packages, has time limits, and makes debugging harder. Not recommended.
- **Kubernetes:** overkill for one VM and a few dozen jobs a day.
- **Open OnDemand or a similar cluster portal:** worth asking IT about first. If it's already installed, it may give collaborators a web interface to Slurm with no custom web code. This could be the cheapest option of all.
- **Giving collaborators cluster accounts:** the cleanest technically if policy allows, but it depends on administrative approval across three other universities.

## Risks

- **Untrusted input.** Collaborators' files will be parsed by your code. Set size limits, validate formats strictly, and enforce a hard time limit per job so one bad input can't run for hours. Don't use pickle or eval on inputs.
- **Resource exhaustion.** Cap concurrent jobs, per-user queue length and memory per job. A 16 GB VM can be exhausted by a few large inputs.
- **Upkeep falls on one person.** Someone must patch the OS, renew certificates, update dependencies and restart services after reboots. Write this down, and make sure a second person knows how to do it.
- **Single point of failure.** One VM, one set of workers. Acceptable for this use, but tell collaborators it isn't a high-availability service.
- **Reproducibility.** Record the code commit, container or dependency versions, input hash, parameters and random seed with every result. Also check whether results change with the number of BLAS threads, since floating-point sums can differ slightly. Results may need a stated tolerance.
- **Data governance.** Unpublished sequences or structures from other universities may fall under data-sharing agreements. Decide retention, deletion and who owns outputs before launch.
- **Scope creep.** Keep it to submit, status, download. Resist building accounts, billing or dashboards.

## What I'd check before committing

1. **Ask IT two questions:** can external users get cluster accounts, and can a service account submit Slurm jobs from the VM? Also ask whether Open OnDemand or an institutional SSO service is available. The answers decide between Phase 1 and Phase 2.
2. **Measure the simulation.** Record peak memory, the distribution of CPU time across realistic inputs, and how runtime scales with input size. Check whether NumPy is multithreaded and what happens with one thread. A 90-second median with a 2-hour tail changes the design.
3. **Check the VM budget.** At a few dozen runs a day, total CPU is well under an hour. Confirm that memory is enough for the largest realistic input, not just the typical one.
4. **Check data classification and licensing** for inputs and outputs, and whether any collaborator needs terms signed before use.
5. **Pilot with two or three collaborators for a few weeks** before opening it to all 20. Watch the failure modes: bad inputs, confusing errors, and how often people email you anyway.
6. **Estimate upkeep honestly.** If the RSE can't commit a few hours a month plus on-call for restarts, prefer the cluster-portal route or a managed platform from IT.

I haven't seen the simulation code, the cluster's policies or the input sizes, so the Phase 1 versus Phase 2 choice depends on items 1 and 2 above.
