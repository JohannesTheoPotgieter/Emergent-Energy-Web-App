#!/usr/bin/env bash
# Pre-commit TypeScript gate for Claude Code.
#
# Fires on PreToolUse for every Bash tool call; we filter for `git commit`
# inside the script so matcher stays simple and we don't fight JSON-path quirks.
#
# Runs `npm run check:client` (fastest TS check — client scoped config only).
# Full check is too slow on this repo to run before every commit; the
# `/ee-pr` slash command runs the full `npm run check` + tests instead.
#
# To disable temporarily: set CLAUDE_SKIP_PRECOMMIT=1 in your environment.
set -euo pipefail

# Read tool input JSON from stdin.
input=$(cat || true)

# Extract the bash command. Fall back to empty string if jq missing / parse fails.
if command -v jq >/dev/null 2>&1; then
  command_str=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
else
  # Crude fallback: grep the raw JSON.
  command_str=$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 || true)
fi

# Only gate on `git commit` invocations.
case "$command_str" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Escape hatch. Also skip when node_modules are absent (env has 43k+ TS errors unrelated to code changes).
if [[ "${CLAUDE_SKIP_PRECOMMIT:-0}" == "1" ]] || [[ ! -d "node_modules" ]]; then
  echo "[pre-commit-check] skipping check:client (CLAUDE_SKIP_PRECOMMIT=1 or no node_modules)" >&2
  exit 0
fi

echo "[pre-commit-check] Running npm run check:client before commit…" >&2
if ! npm run check:client --silent; then
  echo "" >&2
  echo "[pre-commit-check] ❌ check:client failed. Fix TypeScript errors, then retry the commit." >&2
  echo "[pre-commit-check]    To bypass (not recommended): CLAUDE_SKIP_PRECOMMIT=1 git commit …" >&2
  exit 2
fi
echo "[pre-commit-check] ✅ check:client passed." >&2
exit 0
