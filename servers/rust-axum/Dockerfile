FROM rust:1.99.1-slim-trixie AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
# Download dependencies in their own layer; cargo needs a target to read the manifest.
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo fetch --locked
COPY src ./src
RUN cargo build --release --locked && cp target/release/server /server

FROM debian:trixie-slim
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
