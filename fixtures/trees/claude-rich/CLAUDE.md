# Orbit

Event-driven order orchestration service. TypeScript, Node 22, Postgres.

See @docs/ARCHITECTURE.md for the system overview.

## Rules

Style rules are maintained in @.claude/rules/style.md and testing rules in
@.claude/rules/testing.md — follow both.

Roadmap context: @docs/ROADMAP.md

## Build & Test

```bash
npm ci
npm run build
npm test
```

## Conventions

- Every event handler is idempotent; consult the dedup table first.
- Migrations are forward-only. Never edit an applied migration.
- Feature flags come from `src/flags.ts`; no env checks in handlers.
