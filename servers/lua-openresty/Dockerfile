# OpenResty publishes no image or packages for trixie yet, and trixie's apt rejects the SHA-1
# binding on OpenResty's signing key. So a bookworm stage fetches OpenResty's own bookworm packages
# through apt, which checks their signatures, along with the pinned Lua libraries.
FROM debian:bookworm-20261020-slim AS fetch
COPY lua-deps.lock /tmp/
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gpg \
 && curl -fsSL https://openresty.org/package/pubkey.gpg | gpg --dearmor -o /usr/share/keyrings/openresty.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/openresty.gpg] https://openresty.org/package/debian bookworm openresty" \
    > /etc/apt/sources.list.d/openresty.list \
 && apt-get update \
 && mkdir /debs && cd /debs \
 && apt-get download openresty=1.31.8.1-1~bookworm1 openresty-openssl3=3.5.9-1~bookworm1 \
    openresty-pcre2=10.49-1~bookworm1 openresty-zlib=1.3.2-1~bookworm1 \
 && grep -v '^#' /tmp/lua-deps.lock | while read -r name version sha url; do \
      curl -fsSL -o "/tmp/$name.tar.gz" "$url" \
      && echo "$sha  /tmp/$name.tar.gz" | sha256sum -c - \
      && mkdir "/tmp/$name" && tar xzf "/tmp/$name.tar.gz" --strip-components=1 -C "/tmp/$name" \
      || exit 1; \
    done \
 && mkdir -p /lualib/pgmoon \
 && cp /tmp/pgmoon/pgmoon/*.lua /lualib/pgmoon/

# The packages carry their own OpenSSL, PCRE2 and zlib, and need only libc6, libcrypt1 and
# libgcc-s1 from the base, which trixie provides in newer versions.
FROM debian:trixie-20261020-slim
COPY --from=fetch /debs /tmp/debs
RUN apt-get update \
 && apt-get install -y --no-install-recommends /tmp/debs/*.deb \
 && rm -rf /var/lib/apt/lists/* /tmp/debs
COPY --from=fetch /lualib /usr/local/openresty/site/lualib
WORKDIR /app
COPY nginx.conf app.lua start.sh ./
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/app/start.sh"]
