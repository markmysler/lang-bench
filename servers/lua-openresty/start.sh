#!/bin/sh
# Fills in nginx.conf at container start: one worker process per CPU, and the container's DNS
# server, which cosockets need to resolve DB_HOST. exec keeps nginx as PID 1 for the stop signal.
set -e
resolver=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
sed -e "s/@CPUS@/${CPUS:-1}/" -e "s/@RESOLVER@/${resolver:-127.0.0.11}/" /app/nginx.conf > /tmp/nginx.conf
exec /usr/local/openresty/bin/openresty -p /tmp -e stderr -c /tmp/nginx.conf -g 'daemon off;'
