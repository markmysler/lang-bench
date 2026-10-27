#!/usr/bin/env bash
# Runs one fresh Claude Code for the evaluation, in a temporary folder, so it sees nothing of this
# repository. The prompt comes on stdin. LANGBENCH_MODEL picks the model (default: Claude Code's).
#
#   agent.sh answer        answer in an empty folder; prints Claude Code's JSON result
#   agent.sh act <repo>    work in a copy of a mock repository with file tools only (no shell), then
#                          print {"claude": <result>, "changed": [...], "files": {path: content}}
set -u

model=()
if [ -n "${LANGBENCH_MODEL:-}" ]; then model=(--model "$LANGBENCH_MODEL"); fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "${1:-}" in
answer)
  cd "$work" && claude -p --output-format json "${model[@]}"
  ;;
act)
  mkdir "$work/repo" && cp -r "$2"/. "$work/repo" && cd "$work/repo" || exit 1
  git init -q && git add -A &&
    git -c user.email=eval@localhost -c user.name=eval commit -qm "Before the agent" || exit 1
  claude -p --output-format json "${model[@]}" \
    --allowedTools "Read,Write,Edit,Glob,Grep" --max-turns 40 >"$work/claude.json"
  rc=$?
  git add -A
  python3 - "$work/claude.json" <<'PY'
import json, subprocess, sys

raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
try:
    claude = json.loads(raw)
except ValueError:
    claude = {"result": raw, "is_error": True}
changed = subprocess.run(
    ["git", "diff", "--cached", "--name-status"], capture_output=True, text=True
).stdout.splitlines()
files = {}
for line in changed:
    status, _, path = line.partition("\t")
    if status.startswith("D"):
        continue
    try:
        with open(path, encoding="utf-8") as f:
            files[path] = f.read()
    except (UnicodeDecodeError, OSError):
        files[path] = "(binary or unreadable)"
print(json.dumps({"claude": claude, "changed": [l.replace("\t", "  ") for l in changed], "files": files}))
PY
  exit $rc
  ;;
*)
  echo "usage: agent.sh answer | act <repo>" >&2
  exit 2
  ;;
esac
