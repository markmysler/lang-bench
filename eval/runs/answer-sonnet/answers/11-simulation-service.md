# Putting the simulation online

## Short answer

You don't need a faster language. Use Python for the web part, and run the simulation as a separate worker process.

The web layer will do very little: accept an input, validate it, record a job, show status and serve a file. At a few dozen runs a day it will be idle almost all the time. The cost is in the simulation, which is already NumPy and C++. A faster web language would speed up the part that doesn't matter and add a second language for a team that has little web experience.

The total load is about one CPU-hour a day (a few dozen runs of 20 to 90 seconds). One 4-vCPU VM can handle that many times over.

## What I'd build

1. **A small Flask app**, since your RSE already knows Flask. It has an upload or parameter form, a job status page and a results download. Add a few JSON endpoints so collaborators can script submissions later. FastAPI would also work, but I wouldn't switch for its own sake.
2. **A job table in SQLite or Postgres.** Each job stores its status, owner, input, parameters, timestamps and result path.
3. **One or two worker processes on the same VM.** They claim queued jobs and run the simulation as a subprocess with a timeout and memory limit. They write results to disk and send a completion email through the university's SMTP server.
4. **A reverse proxy such as Caddy or nginx in front,** with TLS and Gunicorn behind it. All of it runs under systemd.

The key design choice is that the web process never runs the simulation. A 90-second run inside a request handler would tie up the web server, and a crash or restart would lose the job. A database-backed queue survives reboots and needs nothing beyond what you already run.

Package the simulation as a versioned container or pinned environment, and use that same artifact for the cluster and the VM. That helps reproducibility more than any web choice. Record the code version, input hash, parameters and seed with every result.

## Alternatives I considered

- **Open OnDemand or a university-run portal on the cluster.** This is the first thing to check. If research computing already offers it, it may give you most of this for free, with SSO and real HPC resources. The catch is that collaborators at other universities need sponsored cluster accounts, and you'd get less control over the interface.
- **Web app that submits to Slurm.** This is the right move if runs get much heavier or the volume grows. It adds real complexity now: the VM needs a route to the scheduler, you need a service account, and policies and failure modes multiply. I'd build the queue behind a clean interface so you could swap this in later.
- **Streamlit, Gradio or Dash.** These are great for a quick prototype, and the UI is much faster to write. They're weaker for long jobs that must outlive a browser session, and for users, quotas and history. I'd use one only if the job-submission part is still done properly underneath.
- **Galaxy.** It suits bioinformatics and gives you provenance and users. But it's heavy to install and keep up, which fails your "little upkeep" test.
- **Celery with RabbitMQ or Redis, or Kubernetes.** These are overkill at this scale. Each extra service is something to patch between grants.
- **Cloud functions or autoscaling.** The time limits, cost, data-governance questions and vendor lock-in aren't worth it for about one CPU-hour a day.
- **JupyterHub or Binder.** This would make collaborators write code, which isn't what they asked for.
- **Just shipping the package or container.** Collaborators with their own clusters could run it themselves. I'd do this anyway for reproducibility, but it doesn't help people without HPC access.
- **Rewriting in Go or Rust.** This would cost months and gain nothing measurable.

## Risks

- **Untrusted input is the biggest one.** You'd be running other people's files through your code on a machine on the internet. Parse strictly, set size limits, never unpickle uploads, and run workers as an unprivileged user in a container or under systemd resource limits. Enforce the timeout and memory cap.
- **Authentication.** Don't build your own password system. Use university SSO, federated login (InCommon or eduGAIN) or invite-only accounts via a managed identity provider. Without login, anyone who finds the URL can use your CPUs.
- **CPU oversubscription.** NumPy's BLAS threads can fight each other. Set threads per run to 1 and run 2 to 3 jobs at once. Otherwise runs on the 4 vCPUs can be much slower than expected.
- **Bursts.** One user submitting 50 jobs would block everyone. Add a per-user queue limit and a fair-share rule.
- **Upkeep and bus factor.** The RSE would be the only person who knows the system. Keep it to few moving parts, document it, and have a second person able to restart it.
- **Result retention.** Decide how long results are kept and delete them on a schedule so the disk doesn't fill. Back up the job database.
- **Reproducibility drift.** If someone updates NumPy on the VM, results can change. Pin and container-ize.

## What I'd check before committing

1. **Ask research computing whether Open OnDemand or a similar portal already exists, and what they allow for collaborator access.** This could change the whole plan.
2. **Ask university IT security about hosting an internet-facing service on the VM:** required hardening, patching responsibility, hostname and certificate, and whether the VM can use SSO.
3. **Check data policy.** Are the inputs unpublished, sensitive or subject to agreements, and does that restrict where they can be stored or who can see them?
4. **Measure a real run on the VM,** not the cluster. Check the 20 to 90 second timings, peak memory, thread behavior, and whether results match the cluster bit-for-bit or within tolerance.
5. **Look at the simulation's interface.** Is there a clean entry point with a defined input schema, or does it read scattered files and globals? This will take more of your time than any web work.
6. **Ask a few collaborators** whether they want a form, a script-friendly API, or both. Also ask how large their inputs are and whether the answer can come by email, since a status page may be enough.
7. **Estimate the worst case.** If all 20 users submit 10 jobs at once, that's 200 runs of up to 90 seconds on about 3 workers, so roughly 100 minutes. Decide whether that's acceptable.
8. **Agree who owns it** after the RSE's time is spoken for elsewhere, and what happens if it breaks. If nobody can commit to that, the case for Open OnDemand or a shared package gets stronger.

I'd prototype the Flask app, queue and worker in a week or two, with a handful of collaborators on invitation-only access. That tells you what they actually need before you invest in more.
