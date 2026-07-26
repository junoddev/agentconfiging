#!/usr/bin/env bash
# PreToolUse hook: block raw psql against non-test databases.
set -euo pipefail
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
if [[ "$cmd" == *"psql"* && "$cmd" != *"orbit_test"* ]]; then
  echo '{"decision": "block", "reason": "psql is only allowed against orbit_test"}'
  exit 0
fi
exit 0
