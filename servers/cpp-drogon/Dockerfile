FROM debian:trixie-20261020 AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git g++ cmake make \
    libjsoncpp-dev libpq-dev uuid-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*
# Drogon (and its trantor submodule) pinned by tag and checked against the tag's commit.
ARG DROGON_TAG=v1.9.14
ARG DROGON_COMMIT=3aae769cc405cf5abb9d477675c6430924f02c7c
RUN git clone --depth 1 --branch "$DROGON_TAG" --recurse-submodules --shallow-submodules \
      https://github.com/drogonframework/drogon /drogon \
 && test "$(git -C /drogon rev-parse HEAD)" = "$DROGON_COMMIT"
# A plain CMake Release build; only the PostgreSQL ORM is built, without drogon_ctl or examples.
RUN cmake -S /drogon -B /drogon/build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_CTL=OFF -DBUILD_EXAMPLES=OFF -DBUILD_ORM=ON -DBUILD_BROTLI=OFF -DBUILD_YAML_CONFIG=OFF \
 && cmake --build /drogon/build -j"$(nproc)" \
 && cmake --install /drogon/build
WORKDIR /src
COPY CMakeLists.txt main.cc ./
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && strip -o /server build/server

FROM debian:trixie-20261020-slim
# Shared libraries the server links to (trantor finds OpenSSL because libpq-dev brings it in);
# Drogon and trantor themselves are linked statically.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libjsoncpp26 libpq5 libssl3t64 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
