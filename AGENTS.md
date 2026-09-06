# Agent Instructions

This project uses **Pad** for issue tracking and persistent project context.
Run `pad bootstrap --format json` at the start of a session. Use Pad issue IDs
(for example, `BEAD-42`) whenever referring to tracked work.

## Quick Reference

```bash
pad bootstrap --format json
pad project ready
pad item show <id> --format markdown
pad item update <id> --status in_progress --comment "Why work started"
pad item update <id> --status closed --comment "What was completed"
```

Use Pad for all durable task tracking and project memory. Do not create markdown
TODO lists as a parallel source of truth. The migrated legacy issues live in the
`beads` Pad collection, and migrated persistent knowledge lives in `memories`.

Before changing an item's status, include a comment explaining why. Run the
relevant quality gates before closing implementation work. Do not commit or push
unless the user explicitly authorizes it.

## Non-Interactive Shell Commands

Always use non-interactive flags with file operations to avoid confirmation
prompts:

```bash
cp -f source dest
mv -f source dest
rm -f file
rm -rf directory
cp -rf source dest
```

Other commands that may prompt:

- `scp`: use `-o BatchMode=yes`
- `ssh`: use `-o BatchMode=yes`
- `apt-get`: use `-y`
- `brew`: use `HOMEBREW_NO_AUTO_UPDATE=1`
