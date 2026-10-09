#!/usr/bin/env bash
# Isolated conflict check. Seeds live law, then tries to contradict it.
set -euo pipefail
cd "$(dirname "$0")"
# The numbered task-list prompt is skipped. This sentence is the conflict check.
export SHELF_CONFLICT_PROMPT="${SHELF_CONFLICT_PROMPT:-$PWD/shelf-conflict-clean-prompt.txt}"
exec node ./shelf-conflict-live.mjs
