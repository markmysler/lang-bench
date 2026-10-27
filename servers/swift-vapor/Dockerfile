# Built on Ubuntu 24.04 (glibc 2.39), older than trixie's glibc 2.41, so the binary runs on trixie.
FROM swift:6.4.1-noble AS build
WORKDIR /src
COPY Package.swift Package.resolved ./
RUN swift package resolve --only-use-versions-from-resolved-file
COPY Sources ./Sources
# The Swift runtime and Foundation are linked in statically; the binary needs only libraries that
# debian:trixie-slim already has (glibc, libstdc++, libgcc, zlib).
RUN swift build -c release --static-swift-stdlib \
  && cp "$(swift build -c release --show-bin-path)/server" /server
# Drop the debug information only (symbols stay for crash backtraces), like a default Rust release.
RUN strip --strip-debug /server

FROM debian:trixie-slim
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
