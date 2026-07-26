---
allowed-tools: Bash(gh issue view:*), Bash(git checkout:*), Read, Edit, Write
argument-hint: <issue-number>
description: Fix a GitHub issue end to end
---

## Context

- Current branch: !`git branch --show-current`
- Issue details: !`gh issue view $ARGUMENTS`

## Task

Fix issue #$ARGUMENTS:

1. Create a branch `fix/$ARGUMENTS-short-slug`.
2. Write a failing test that reproduces the issue, then make it pass.
3. Summarize the change; do not commit or push.
