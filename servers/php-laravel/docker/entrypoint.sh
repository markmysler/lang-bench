#!/bin/sh
# Starts PHP-FPM, then nginx in the foreground as the container's main process.
set -e
cpus="${CPUS:-1}"
case "$cpus" in '' | *[!0-9]* | 0) cpus=1 ;; esac
export FPM_CHILDREN=$((cpus * 8))
sed -i "s/^worker_processes .*/worker_processes $cpus;/" /etc/nginx/nginx.conf

cd /app
# Laravel needs an encryption key; nothing is encrypted here, so a random one per container will do.
export APP_KEY="${APP_KEY:-base64:$(php -r 'echo base64_encode(random_bytes(32));')}"
# Rebuild the config cache so it holds this container's DB_* variables.
php artisan config:cache >/dev/null

mkdir -p /run/php
php-fpm &
while [ ! -S /run/php/php-fpm.sock ]; do sleep 0.05; done
exec nginx -g 'daemon off;'
