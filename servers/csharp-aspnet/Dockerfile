FROM mcr.microsoft.com/dotnet/sdk:10.0.403-noble AS build
WORKDIR /src
# Packages in their own layer, so code changes don't restore them again.
COPY Server.csproj packages.lock.json ./
RUN dotnet restore --locked-mode
COPY Program.cs appsettings.json ./
RUN dotnet publish -c Release --no-restore -o /app

# Microsoft publishes no Debian image for .NET 10 (only Ubuntu, Alpine and Azure Linux), so the
# ASP.NET Core runtime is copied from the official Ubuntu image into debian:trixie-slim.
FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble AS runtime

FROM debian:trixie-slim
# The libraries the official runtime-deps images install (ICU, so globalization works as shipped).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libc6 libgcc-s1 libicu76 \
       libssl3t64 libstdc++6 tzdata zlib1g \
    && rm -rf /var/lib/apt/lists/*
ENV DOTNET_RUNNING_IN_CONTAINER=true
COPY --from=runtime /usr/share/dotnet /usr/share/dotnet
RUN ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet
COPY --from=build /app /app
WORKDIR /app
EXPOSE 8080
# Framework-dependent app on the shared runtime, with the runtime's defaults: Server GC (ASP.NET
# Core's default), tiered JIT with dynamic PGO, and processor count and GC heap limit taken from
# the container's CPU and memory limits.
ENTRYPOINT ["dotnet", "Server.dll"]
