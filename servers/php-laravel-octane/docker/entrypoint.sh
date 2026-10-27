#!/bin/sh
# Starts Laravel Octane on FrankenPHP with one worker per CPU.
set -e
cpus="${CPUS:-1}"
case "$cpus" in '' | *[!0-9]* | 0) cpus=1 ;; esac

cd /app
# Laravel needs an encryption key; nothing is encrypted here, so a random one per container will do.
export APP_KEY="${APP_KEY:-base64:$(php -r 'echo base64_encode(random_bytes(32));')}"
# Rebuild the config cache so it holds this container's DB_* variables.
php artisan config:cache >/dev/null

# Octane runs the frankenphp binary with its own Caddyfile, and stays in front as PID 1 to stop
# it on SIGTERM. --max-requests is left at Octane's default (500).
exec php artisan octane:start --server=frankenphp --host=0.0.0.0 --port="${PORT:-8080}" \
    --workers="$cpus"
