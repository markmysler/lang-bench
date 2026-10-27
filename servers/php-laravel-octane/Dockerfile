# Dependencies are installed by Composer in its own image; only vendor/ is copied out of it.
FROM composer:2.10.3 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
COPY app ./app
RUN composer install --no-dev --optimize-autoloader --no-scripts --no-interaction --no-progress

# The official FrankenPHP image: PHP 8.5 embedded in FrankenPHP (Caddy), on Debian trixie.
FROM dunglas/frankenphp:1.13.4-php8.5.12-trixie
# pcntl lets the Octane command handle signals to stop the server.
RUN install-php-extensions pdo_pgsql pcntl \
    && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY docker/opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr CACHE_STORE=array SESSION_DRIVER=array \
    OCTANE_SERVER=frankenphp
WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY . .
# package:discover is the step composer's scripts would run; optimize caches config, routes,
# events and views. The config cache is rebuilt at start to pick up the container's DB_* values.
RUN rm -rf docker \
    && php artisan package:discover \
    && php artisan optimize \
    && chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
