#!/usr/bin/env bash
# Run one isolated live bind-harvest check. No pasting.
set -euo pipefail
cd "$(dirname "$0")"
exec node ./shelf-harvest-live.mjs
