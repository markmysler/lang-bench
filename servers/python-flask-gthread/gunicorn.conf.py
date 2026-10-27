# gunicorn settings for python-flask-gthread: threaded workers, a thread pool per process.
import os


def env(key, default):
    try:
        n = int(os.environ.get(key, ""))
    except ValueError:
        return default
    return n if n > 0 else default


bind = f"0.0.0.0:{env('PORT', 8080)}"
worker_class = "gthread"
# One process per core (the GIL limits a process to one core), each with 4 request threads.
workers = env("CPUS", 1)
threads = 4
# Read by app.py in every worker to share DB_POOL out between the processes.
os.environ["WORKERS"] = str(workers)
# The worker heartbeat file goes in memory, as gunicorn's docs advise for containers.
worker_tmp_dir = "/dev/shm"
# No access log (gunicorn's default, stated here to be explicit); errors go to stderr.
accesslog = None
errorlog = "-"
