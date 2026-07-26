# Taskboard

Kanban board web app. TypeScript + Express + SQLite.

## Build & Test

```bash
npm install
npm run build
npm test
```

## Conventions

- Use ES modules everywhere; no `require()`.
- All API handlers live in `src/routes/` and return typed responses.
- Never commit directly to `main`; branch per feature.
