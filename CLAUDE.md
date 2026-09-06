# Project Instructions for AI Agents

This project uses **Pad** for durable task tracking and project context. Start
each session with `pad bootstrap --format json`, use Pad issue IDs in handoffs,
and record status changes with an explanatory `--comment`.

The migrated legacy issues are in the `beads` Pad collection. Migrated project
knowledge is in the `memories` collection. Do not use Beads or create markdown
TODO lists as a parallel tracker.

## Build & Test

Run the quality gates appropriate to the change. `npm run release:gate` is the
full release gate.

## Architecture Overview

See `docs/SPEC.md`, `docs/DESIGN.md`, and `docs/EXECUTION.md`.
