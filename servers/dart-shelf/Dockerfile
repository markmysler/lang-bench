FROM dart:3.13.7-sdk AS build
WORKDIR /src
COPY pubspec.yaml pubspec.lock ./
RUN dart pub get --enforce-lockfile
COPY bin ./bin
RUN dart compile exe bin/server.dart -o /server

# An AOT executable needs only the C library, so it runs in plain debian:trixie-slim.
FROM debian:trixie-slim
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
