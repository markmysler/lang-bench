# Putting the folding simulation online for collaborators

## Short answer

**You don't need a faster language.** The web part only accepts a form, saves a file and shows a results page. Each of those takes milliseconds in Python, and the simulation's 20–90 seconds of compute dwarfs it. Rewriting the web layer in Go, Rust or Node would add a second language to maintain and wouldn't make anything faster. If you later want quicker runs, speed up the simulation itself with more C++ or Numba. The web layer isn't where the time goes.

**What I'd build:** a small Flask app on your VM that puts submitted jobs in a queue. A separate worker process runs them in the background, and collaborators come back to a results page or get an email when their job finishes. This fits what your research software engineer already knows, it fits your load easily, and it has very few parts to look after.

## The design

**1. Turn the simulation into a command-line tool first.** It should take an input file and parameters and write a results folder, with no Jupyter involved. Pin the environment with a conda lock file or a container image. You need this for the web service anyway, and it's the single biggest step for reproducibility. The same container (Apptainer) also runs on your cluster and on your collaborators' clusters.

**2. Web app: Flask behind a proper web server.** Use Gunicorn behind Caddy or nginx, with HTTPS. Don't use Flask's built-in development server. It needs only a handful of pages:
- log in
- submit a job (upload input, set parameters)
- my jobs (queued / running / done / failed)
- download results

**3. Never run the simulation inside a web request.** This is the one architectural rule that matters. A 90-second request will hit proxy timeouts, tie up the web server, and get lost if the user closes their browser. Instead:
- The web app writes a job record to a small database (SQLite is enough) and returns straight away.
- A separate worker process picks up queued jobs, runs the command-line tool in a subprocess, and records the result.
- If you'd rather not write the job-claiming logic yourselves, **Huey** with SQLite storage is a small, mature library that does this without adding Redis or another service.
- Run the web app and the worker as two systemd services that restart automatically if they crash.

**4. Size it for your VM.**
- **Workers:** run 3 simulations at once and leave one vCPU for the web app and the OS. Run each in its own process, because Python threads won't run NumPy code in parallel here.
- **Threads:** set NumPy's math-library threads to 1 per worker (OMP_NUM_THREADS and similar settings). Otherwise each run may try to use all 4 cores and they'll slow each other down. This is the most common performance mistake in this kind of setup.
- **Capacity:** a few dozen runs a day is under one CPU-hour, and 3 workers give you about 72 CPU-hours a day, so you have roughly 100× headroom. In a bad burst, say 60 jobs submitted at once, the last one waits about 30 minutes. Tell users the queue length so they know what to expect.
- **Fairness:** cap each user at a few queued jobs so one person can't fill the queue.

**5. Record what was run, every time.** Store and include in each download:
- the code version (git commit or container image digest)
- a hash of the input file
- all parameters and the random seed
- start and end times

That way a result from the web tool is as traceable as one from the cluster.

## Alternatives I considered

| Option | Why not (or not yet) |
|---|---|
| **Collaborators run it themselves** (container or pip/conda package) | A strong option, and step 1 gets you most of the way. A 90-second run fits on a laptop. But many users won't want to install anything, and you lose a central record of runs. Offer it alongside the web app, not instead of it. |
| **Web app sends jobs to the HPC cluster (Slurm)** | Free compute, but many universities forbid automated submission from a web-facing machine. Cluster queue waits can be hours for a 1-minute job. Cluster credentials on an internet-facing VM are a security risk. Keep it as the plan if load grows 50×; the queue design lets you swap the backend later. |
| **Streamlit / Gradio** | Quickest to demo. But they're weak at long-running jobs, results that survive a closed browser, per-user job history and proper logins. Good for a prototype, fragile for a shared service. |
| **FastAPI** | Its async model doesn't help CPU-heavy work, and your engineer knows Flask. No real gain. |
| **Django** | The built-in admin and user accounts are tempting, but it's more framework to learn. Reasonable if your engineer prefers it; Flask is enough here. |
| **Celery + Redis / RabbitMQ** | Built for far larger scale. More services to run and patch for no benefit at a few dozen jobs a day. |
| **Galaxy** | Excellent in bioinformatics, but heavy to host yourselves. Worth a look only if collaborators already use a public Galaxy server you could publish the tool to. |
| **Commercial cloud** (AWS, Modal, etc.) | Billing, procurement and data-governance paperwork, while your free VM already has plenty of capacity. |

## Risks

- **Security of a public-facing server.** Don't open it to anonymous users, both to prevent compute abuse and because inputs are untrusted files.
  - Login: use university single sign-on if IT can put it in front of the app. Otherwise ORCID login suits academics well, or an invite-only email login link.
  - Run the worker as an unprivileged user with a time limit (kill after, say, 10 minutes) and a memory cap (systemd can enforce both).
  - Validate input size and format, and never unpickle uploaded files.
- **Upkeep with one engineer.** Turn on automatic OS security updates, add a free uptime check, and write a one-page runbook (how to restart, where the logs are, how to deploy a new version). Then the service doesn't depend on one person's memory or outlast their contract. Back up the job database, or decide explicitly that losing job history is acceptable.
- **Results differ from the cluster.** A different CPU or math library can change floating-point results, and seeds may not be handled the same way. Check this before launch (see below).
- **Disk space.** Set a retention policy, e.g. delete results after 30–60 days and tell users.
- **Unpublished data.** Collaborators may upload sensitive inputs. Agree on terms of use, retention and citation up front.

## What I'd check before committing

1. **Ask the collaborators what they actually need.** Is it one input at a time through a web form, or hundreds in a batch? Batches of hundreds point towards the cluster or running it themselves. Do any of them already have a cluster where a container would just work?
2. **Measure the simulation itself:**
   - peak memory per run (× 3 workers must fit in 16 GB with room to spare)
   - whether it uses several threads
   - the worst-case runtime: can some input make it run for an hour?
3. **Check reproducibility.** Run 5–10 reference inputs on the cluster and on the VM and compare the outputs within agreed tolerances.
4. **Talk to university IT early; this is often the slowest part:**
   - Can the VM be reachable from outside the university, with a hostname and an HTTPS certificate?
   - Is single sign-on available for external users (eduGAIN/InCommon)?
   - Is there an email relay for notifications?
   - Is there a security review you need to pass?
5. **Ask the HPC team** whether automated job submission is allowed, so you know if the cluster option is open for later.
6. **Licensing:** decide the software licence and how results should be cited.

## Suggested order

1. Package the simulation as a command-line tool in a container.
2. Build the minimal Flask app with the queue and worker.
3. Pilot it with one collaborator group for a few weeks.
4. Open it to the other two groups.

For someone who has built a Flask app before, the first version is weeks of work, not months. The work is mostly packaging and operations, not web technology.
