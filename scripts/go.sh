#!/usr/bin/env sh
# Runs the Go toolchain in Docker, so the orchestrator can be developed without installing Go.
# Usage: scripts/go.sh test ./...
set -e
root="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
MSYS_NO_PATHCONV=1 exec docker run --rm \
  -v "$root:/src" -w /src/orchestrator \
  -v langbench-gocache:/root/.cache/go-build -v langbench-gomod:/go/pkg/mod \
  golang:1.26-trixie go "$@"
