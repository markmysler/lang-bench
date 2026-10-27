FROM python:3.14.10-slim-trixie
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_ROOT_USER_ACTION=ignore
WORKDIR /app
COPY requirements.txt ./
# --only-binary: every package comes as a prebuilt wheel (psycopg-binary bundles libpq).
RUN pip install --only-binary=:all: -r requirements.txt
COPY app.py gunicorn.conf.py ./
EXPOSE 8080
# gunicorn.conf.py sizes the workers from CPUS. exec keeps gunicorn as PID 1 so it receives the
# stop signal.
CMD exec gunicorn --config gunicorn.conf.py app:app
