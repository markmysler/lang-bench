# Puma in cluster mode: one worker process per CPU, each with Rails' default of 3 threads.
# Ruby's GVL lets only one thread per process run Ruby code at a time, so processes use the cores
# and threads overlap waits on I/O and the database.
threads_count = Integer(ENV.fetch("RAILS_MAX_THREADS", 3))
threads threads_count, threads_count

cpus = Integer(ENV.fetch("CPUS", 1), exception: false)
workers(cpus && cpus > 0 ? cpus : 1)
# Load the app once in the master and fork the workers from it, sharing memory copy-on-write.
preload_app!
# A single worker is still run in cluster mode, so every size is tuned the same way.
silence_single_worker_warning

port Integer(ENV.fetch("PORT", 8080)), "0.0.0.0"
environment ENV.fetch("RAILS_ENV", "production")
