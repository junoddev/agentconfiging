# Marketing demo fixture

This fictional project contains only sanitized configuration. It backs the product-proof window on the marketing page: Claude Code, Codex, and Cursor are detected, while `.claude/settings.local.json` is intentionally present without a `.gitignore` so the `settings-local-committed` analyzer proposes an exact, reviewable fix.

From the repository root, build the CLI and run:

```sh
npm run build
node dist/cli/index.js report site/fixtures/demo-repo --pretty
```

The report exits with code `2` because the fixture intentionally contains an error-severity finding. It summarizes the fix without serializing replacement file contents. In the local UI, the dry-run review shows this proposed diff without writing it:

```diff
+.claude/settings.local.json
```
