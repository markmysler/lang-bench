# gunicorn settings for python-flask-gevent: gevent workers, one greenlet per connection.
import os


def env(key, default):
    try:
        n = int(os.environ.get(key, ""))
    except ValueError:
        return default
    return n if n > 0 else default


bind = f"0.0.0.0:{env('PORT', 8080)}"
# The gevent worker monkey-patches the standard library (sockets, select, time.sleep, threading)
# before it imports app.py, so blocking calls switch to another greenlet instead of blocking.
worker_class = "gevent"
# One process per core: each runs an event loop, and the GIL limits a process to one core.
workers = env("CPUS", 1)
# Concurrent connections (greenlets) per worker; 1000 is gunicorn's default, stated explicitly.
worker_connections = 1000
# Read by app.py in every worker to share DB_POOL out between the processes.
os.environ["WORKERS"] = str(workers)
# The worker heartbeat file goes in memory, as gunicorn's docs advise for containers.
worker_tmp_dir = "/dev/shm"
# No access log (gunicorn's default, stated here to be explicit); errors go to stderr.
accesslog = None
errorlog = "-"
