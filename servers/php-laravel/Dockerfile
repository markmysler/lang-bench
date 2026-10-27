# Dependencies are installed by Composer in its own image; only vendor/ is copied out of it.
FROM composer:2.10.3 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
COPY app ./app
RUN composer install --no-dev --optimize-autoloader --no-scripts --no-interaction --no-progress

FROM php:8.5.12-fpm-trixie
# nginx from Debian, and the pdo_pgsql extension (libpq-dev only while it compiles).
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx libpq5 libpq-dev \
    && docker-php-ext-install pdo_pgsql \
    && apt-get purge -y libpq-dev && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /etc/nginx/conf.d \
    && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && sed -i '/^access.log/d' /usr/local/etc/php-fpm.d/docker.conf
COPY docker/opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini
COPY docker/fpm-pool.conf /usr/local/etc/php-fpm.d/zz-bench.conf
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr CACHE_STORE=array SESSION_DRIVER=array
WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY . .
# package:discover is the step composer's scripts would run; optimize caches config, routes,
# events and views. The config cache is rebuilt at start to pick up the container's DB_* values.
RUN rm -rf docker \
    && php artisan package:discover \
    && php artisan optimize \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
