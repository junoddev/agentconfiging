#!/usr/bin/env bash
# statusLine command: model + branch + dirty marker.
input=$(cat)
model=$(printf '%s' "$input" | jq -r '.model.display_name')
branch=$(git branch --show-current 2>/dev/null || echo "?")
dirty=$(git status --porcelain 2>/dev/null | head -1 | grep -q . && echo "*" || echo "")
printf '[%s] %s%s' "$model" "$branch" "$dirty"
