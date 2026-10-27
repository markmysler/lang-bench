# Postgres for the /db and /queries workloads. The orchestrator pins it to its own cores.
FROM postgres:18-trixie
ENV POSTGRES_USER=bench POSTGRES_PASSWORD=bench POSTGRES_DB=bench
COPY init.sql /docker-entrypoint-initdb.d/
# Healthy only once the real server listens on TCP, after the init scripts have run.
HEALTHCHECK --interval=500ms --timeout=2s --start-period=30s --retries=120 \
  CMD pg_isready -U bench -d bench -h 127.0.0.1 || exit 1
# Read-only workloads: durability settings do not affect them, and every server shares them.
CMD ["postgres", "-c", "max_connections=1000", "-c", "shared_buffers=256MB", "-c", "fsync=off", "-c", "synchronous_commit=off"]
