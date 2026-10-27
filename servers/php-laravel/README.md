# PHP + Laravel (PHP-FPM + nginx)

- **Server:** Laravel 13 on PHP 8.5 in `php:8.5.12-fpm-trixie`, behind nginx from Debian in the
  same container. A small entrypoint starts PHP-FPM, then runs nginx in the foreground. nginx uses
  the site from Laravel's deployment guide and passes requests to PHP-FPM over a unix socket; its
  access log is off, and its keep-alive limit of 1000 requests per connection is raised, since the
  other servers have none. PHP uses `php.ini-production` with OPcache on,
  `validate_timestamps=0` and no JIT. `php artisan optimize` caches the config, routes, events and
  views at build time; the config cache is rebuilt when the container starts so that it holds the
  container's `DB_*` variables. Dependencies are installed with
  `composer install --no-dev --optimize-autoloader` from `composer.lock`.
- **Concurrency:** PHP-FPM runs a fixed pool (`pm = static`) of `8 × CPUS` child processes, each
  handling one request at a time, from start to finish; nginx runs `CPUS` worker processes. There
  are more children than cores because a child waiting on the database or on `/io` holds no CPU.
  Each request boots Laravel from the OPcache'd code, as PHP's shared-nothing model does.
- **Database:** Eloquent, with a `World` model whose `randomnumber` column is written out as
  `randomNumber`. Laravel's default for PHP-FPM: no persistent connections, so each request opens
  its own connection when it first queries and closes it at the end. `DB_POOL` is unused; at most
  one connection per child is open at a time (`8 × CPUS`). PDO uses real (server-side) prepared
  statements, prepared again for every query. TLS to Postgres is disabled (`sslmode=disable`),
  since the benchmark database has none.
- **`/io`:** `usleep`, which blocks the whole FPM child while it waits: the pool can hold at most
  `8 × CPUS` waits at once, and further requests queue in nginx. That is PHP-FPM's model. Any
  shortfall against the monotonic clock is slept again, so the response never comes early.
- **Middleware:** routes are in `routes/api.php` with no prefix, so the `web` group (sessions,
  cookies, CSRF) never runs; Laravel's default global middleware does. `APP_KEY` is generated at
  random when the container starts (nothing is encrypted). Errors are logged to stderr.
- **Compared with `php-laravel-octane`:** the same app and Eloquent code, but here every request
  boots the framework and opens a database connection, and concurrency comes from many processes.
  Octane boots Laravel once per worker and keeps it, and its database connection, in memory, with
  one worker per CPU.
