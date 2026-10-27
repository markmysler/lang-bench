# PHP + Laravel (Octane + FrankenPHP)

- **Server:** Laravel 13 on Laravel Octane 2.22 with FrankenPHP 1.13 (PHP 8.5 embedded in the
  Caddy web server), in the official `dunglas/frankenphp:1.13.4-php8.5.12-trixie` image. The
  container runs `php artisan octane:start --server=frankenphp`, which starts FrankenPHP with
  Octane's own Caddyfile (logging at `WARN`, so nothing per request; its response compression
  only applies when the client asks for it). PHP uses `php.ini-production` with OPcache on,
  `validate_timestamps=0` and no JIT, as in `php-laravel`. `php artisan optimize` caches the
  config, routes, events and views at build time; the config cache is rebuilt when the container
  starts so that it holds the container's `DB_*` variables. Dependencies are installed with
  `composer install --no-dev --optimize-autoloader` from `composer.lock`.
- **Concurrency:** `--workers=CPUS` FrankenPHP worker threads. Each boots Laravel once, keeps it
  in memory and handles one request at a time; Octane resets request state between requests.
  `--max-requests` stays at Octane's default of 500, so each worker is restarted (and re-boots
  Laravel) after 500 requests, Octane's guard against memory leaks.
- **Database:** the same Eloquent `World` model as `php-laravel`. Octane keeps each worker's
  database connection open across requests, so there is one persistent connection per worker
  (`CPUS` in all). `DB_POOL` is unused. PDO uses real (server-side) prepared statements, prepared
  again for every query. TLS to Postgres is disabled (`sslmode=disable`).
- **`/io`:** `usleep`, which blocks the worker thread while it waits, so the server holds at most
  `CPUS` waits at once and other requests queue. With one worker per CPU this is far fewer
  concurrent waits than `php-laravel`'s `8 × CPUS` FPM children; that follows from Octane's
  recommended worker count. Any shortfall against the monotonic clock is slept again.
- **Middleware:** routes are in `routes/api.php` with no prefix, so the `web` group (sessions,
  cookies, CSRF) never runs; Laravel's default global middleware does. Octane resolves the
  encrypter when a worker boots, so `APP_KEY` is generated at random when the container starts
  (nothing is encrypted). Errors are logged to stderr. The `pcntl` extension is installed for
  Octane's signal handling.
- **Compared with `php-laravel`:** the same app and code. PHP-FPM boots Laravel and connects to
  the database on every request, with many processes per core; Octane boots it once per worker
  and keeps it and its connection in memory, with one worker per core. Octane is faster per
  request, but holds fewer blocking requests (`/io`) at once.
