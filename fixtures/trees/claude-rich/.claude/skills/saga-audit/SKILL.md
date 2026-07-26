---
name: saga-audit
description: Audit a saga definition for missing compensations and dedup gaps. Use when reviewing or writing saga steps.
allowed-tools: Read, Grep, Glob
---

# Saga audit

For each step module in `src/steps/`:

1. Confirm it registers a compensation in `src/saga/compensations.ts`.
2. Confirm the handler's first await is a dedup-table check.
3. Flag any direct import of the bus client (must go through the outbox).

Output a table: step | compensation | dedup | outbox-clean.
