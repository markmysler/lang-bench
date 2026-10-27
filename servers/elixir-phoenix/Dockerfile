FROM elixir:1.20.4-otp-29 AS build
ENV MIX_ENV=prod
WORKDIR /app
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
COPY config/config.exs config/
RUN mix deps.compile
COPY lib lib
COPY rel rel
COPY config/runtime.exs config/
RUN mix release

# The release carries its own ERTS, built on trixie, so it needs only the system libraries.
FROM debian:trixie-20261020-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8
WORKDIR /app
RUN useradd --system --no-create-home phoenix
COPY --from=build --chown=phoenix /app/_build/prod/rel/bench ./
USER phoenix
EXPOSE 8080
ENTRYPOINT ["/app/bin/bench", "start"]
