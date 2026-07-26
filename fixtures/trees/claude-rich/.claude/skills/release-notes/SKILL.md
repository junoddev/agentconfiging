---
name: release-notes
description: Generate release notes from merged PRs since the last tag. Use when the user asks for release notes, a changelog entry, or a deploy summary.
---

# Release notes

1. Find the last tag: `git describe --tags --abbrev=0`.
2. List merged PRs since then: `gh pr list --state merged --search "merged:>TAG_DATE"`.
3. Group by label: `feature`, `fix`, `ops`.
4. Write the notes in the house format (see reference.md) to stdout — never
   commit them yourself.
