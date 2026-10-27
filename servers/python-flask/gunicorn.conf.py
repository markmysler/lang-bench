# gunicorn settings for python-flask: synchronous workers, one request at a time per process.
import os


def env(key, default):
    try:
        n = int(os.environ.get(key, ""))
    except ValueError:
        return default
    return n if n > 0 else default


bind = f"0.0.0.0:{env('PORT', 8080)}"
worker_class = "sync"
# gunicorn's documented starting point for the number of workers: (2 x cores) + 1. Sync workers
# block on I/O, so the extra processes keep the cores busy while others wait.
workers = 2 * env("CPUS", 1) + 1
# Read by app.py in every worker to share DB_POOL out between the processes.
os.environ["WORKERS"] = str(workers)
# The worker heartbeat file goes in memory, as gunicorn's docs advise for containers.
worker_tmp_dir = "/dev/shm"
# No access log (gunicorn's default, stated here to be explicit); errors go to stderr.
accesslog = None
errorlog = "-"
