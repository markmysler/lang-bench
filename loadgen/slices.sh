#!/bin/sh
# Applies load to $URL with $CONNECTIONS connections for $SLICES one-second slices, printing
# oha's JSON summary of each slice on its own line so the orchestrator can chart it live.
# Connections are opened again for each slice; that costs every server the same. No compression
# is requested, so every server sends the same bytes (docs/SPEC.md).
set -u
i=0
while [ "$i" -lt "$SLICES" ]; do
  oha -z 1s -w -c "$CONNECTIONS" --disable-compression --no-tui --output-format json "$URL" | tr -d '\n'
  echo
  i=$((i + 1))
done
