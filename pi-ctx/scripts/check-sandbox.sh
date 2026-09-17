#!/usr/bin/env bash
# Probe the *Pi agent* cplt profile. Do not use `cplt exec` — that is the shell profile.
set -euo pipefail

CPLT_BIN="${CPLT_BIN:-cplt}"
CTX_PATH="${HOME}/.pi/ctx"

if ! command -v "$CPLT_BIN" >/dev/null 2>&1; then
  echo "check-sandbox: cplt not on PATH; skip"
  exit 0
fi

echo "== cplt --agent pi --print-profile (paths of interest) =="
profile="$("$CPLT_BIN" --agent pi --print-profile 2>/dev/null || true)"
if [[ -z "$profile" ]]; then
  echo "check-sandbox: empty profile (cplt failed?)"
  exit 1
fi

printf '%s\n' "$profile" | grep -E 'pi/|\.pi|scratch|tmp/cplt|/tmp' || true

echo
echo "== project-law grant: ${CTX_PATH} =="
if printf '%s\n' "$profile" | grep -q "$CTX_PATH"; then
  echo "OK  print-profile lists ${CTX_PATH}"
else
  echo "MISSING  ${CTX_PATH} is not in the Pi agent profile."
  echo "         Session inject still works. Bind / project law will fail inside default \`pi\`."
  echo "         Fix: mkdir -p ${CTX_PATH}"
  echo "              add --allow-write \"\$HOME/.pi/ctx\" to ~/.local/bin/pi"
  echo "              add \"~/.pi/ctx\" to ~/.config/cplt/config.toml [allow] write"
  if [[ "${CPLT_REQUIRE_CTX:-}" == "1" ]]; then
    exit 2
  fi
fi

echo
echo "== notes =="
echo "- Default \`pi\` is the cplt wrapper; \`pi-unsafe\` is the real CLI."
echo "- \`cplt exec\` is NOT this profile. See docs/sandbox.md."
echo "- Tests set CTX_HOME; they must not write ${CTX_PATH}."
exit 0
