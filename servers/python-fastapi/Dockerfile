FROM python:3.14.10-slim-trixie
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_ROOT_USER_ACTION=ignore
WORKDIR /app
COPY requirements.txt ./
# --only-binary: uvloop, httptools, asyncpg and pydantic-core must come as prebuilt wheels.
RUN pip install --only-binary=:all: -r requirements.txt
COPY main.py ./
EXPOSE 8080
# One uvicorn worker process per CPU, each with its own uvloop event loop and httptools parser.
# exec keeps uvicorn as PID 1 so it receives the stop signal.
CMD exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}" --workers "${CPUS:-1}" \
    --loop uvloop --http httptools --no-access-log
