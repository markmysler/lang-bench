#!/usr/bin/env sh
# Runs the langbench command from source in Docker, on the benchmark network, without installing
# Go. Usage: scripts/langbench.sh conform go-gin
set -e
root="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
# Labelled as docker compose labels it, so the dashboard can share the network without warnings.
docker network inspect langbench >/dev/null 2>&1 || docker network create \
  --label com.docker.compose.network=langbench --label com.docker.compose.project=langbench \
  langbench >/dev/null
MSYS_NO_PATHCONV=1 exec docker run --rm --network langbench \
  -v "$root:/work" -w /work/orchestrator \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v langbench-gocache:/root/.cache/go-build -v langbench-gomod:/go/pkg/mod \
  golang:1.26-trixie go run ./cmd/langbench "$@"
