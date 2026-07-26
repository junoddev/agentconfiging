---
description: Security-focused review of the working diff
allowed-tools: Read, Grep, Bash(git diff:*)
---

Review the current diff (`git diff main...HEAD`) for:

- secrets or connection strings in code or config
- SQL built by string concatenation
- event payload fields logged without redaction

Severity levels: block / warn / note.
