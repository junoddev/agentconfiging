#!/usr/bin/env bash
# Stop hook: desktop notification when a long task finishes.
command -v notify-send >/dev/null && notify-send "Claude" "Task finished in orbit" || true
