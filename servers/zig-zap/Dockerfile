FROM debian:trixie-20261020 AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
# The official Zig release, pinned by version and checked against its published SHA-256.
ARG ZIG_VERSION=0.15.2
ARG ZIG_SHA256=02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239
RUN curl -fsSL -o /tmp/zig.tar.xz "https://ziglang.org/download/$ZIG_VERSION/zig-x86_64-linux-$ZIG_VERSION.tar.xz" \
 && echo "$ZIG_SHA256  /tmp/zig.tar.xz" | sha256sum -c - \
 && mkdir /zig && tar -xJf /tmp/zig.tar.xz -C /zig --strip-components=1 && rm /tmp/zig.tar.xz
ENV PATH=/zig:$PATH
WORKDIR /src
COPY build.zig build.zig.zon ./
# Download the dependencies pinned (by commit and hash) in build.zig.zon in their own layer.
RUN zig build --fetch
COPY src ./src
# ReleaseFast for a generic x86-64 CPU (Zig's default would tune for the build machine's CPU).
RUN zig build -Doptimize=ReleaseFast -Dcpu=baseline

FROM debian:trixie-20261020-slim
COPY --from=build /src/zig-out/lib/libfacil.io.so /usr/local/lib/
RUN ldconfig
COPY --from=build /src/zig-out/bin/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
