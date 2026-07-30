# Usage Guide

A user-facing walkthrough of `agentconfiging`. For the design rationale see
[SPEC.md](./SPEC.md) and [DESIGN.md](./DESIGN.md); for internals see
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Getting started

Run it in any repo:

```bash
npx agentconfiging
```

The CLI:

1. Scans the current directory into a report.
2. Starts a Hono server on `127.0.0.1` at a random port.
3. Generates a per-session token and prints a URL that embeds it.
4. Opens your browser to that URL and shows an Ink terminal UI with the instance
   list, status, and a live log pane.

A copy of everything shown in the log pane is also written to
`~/.local/state/agentconfiging/logs/<timestamp>.log` (override with
`AGENTCONFIGING_LOG_DIR`). The log path is printed on startup.

### The terminal UI (Ink)

The launch UI mirrors the web app's instance management:

- Arrow keys / `j`,`k` — select an instance
- `enter` — open the selected instance in the browser
- `a` — add a folder as an instance
- `s` — scan a folder recursively for agent-configured projects
- `q` — quit

`report` and `daemon` never use Ink — they emit plain output for CI and cron.

## Instances (multi-root workspace)

The app manages **instances**: roots whose agent config it has loaded. Nothing is
scanned until you ask.

- Launching creates the first instance (the current folder).
- **Add a folder** loads one instance.
- **Scan a folder recursively** does a bounded, symlink-safe marker walk to
  discover agent-configured projects underneath, then offers the hits to add.
- Repos seen in your Claude history are surfaced as add suggestions.

Instances load lazily (the full engine run + file watcher start on first open) and
the list persists in `~/.local/state/agentconfiging/workspace.json`, so the next
launch restores your workspace. One server process hosts all instances; you switch
between them from the CLI, the web UI, or the Cmd+K palette.

## Feature areas

Navigation is a numbered left rail; the numbers double as `Cmd+1..9` shortcuts.

### Inspect

- **Overview / Agents** — each detected runtime with a confidence meter, file
  count, and a waveform derived from its config.
- **Artifacts** — browse config files rendered as text. Secrets are redacted
  server-side before they reach the browser.
- **Findings** — results from 13 analyzers (broken `@import`, duplicate/shadowed
  rules, missing hook scripts, MCP command not on PATH, subagent references a
  missing tool, permissive permissions, stale model refs, committed
  `settings.local.json`, conflicting instructions, and more). Findings with a
  machine fix show an **APPLY** button.

### Edit (write-back)

Visual editors for every config type: `settings.json` (model, permissions, env,
statusLine, shared vs. local scope), hooks, instruction files, memory, MCP
servers, skills & agents (with a connections view), rules, and
`keybindings.json`. **Every write is previewed as a unified diff before it
commits. Deletes go to trash, not delete.**

### Sync

Designate a source-of-truth instruction file or rules directory and regenerate the
other runtimes' instruction files from it — diff-previewed like any other write,
with per-runtime sync-status indicators. One-click resolve on instruction-drift
findings.

### Catalog & Marketplace

Browse an installable registry (subagents, skills, commands, MCP servers, hooks,
plus runtime-setup templates) and the Claude Code plugin marketplace. A 40-entry
seed ships in the package so the catalog works offline on first run. Installs are
checksum-verified, diff-previewed, and stamped with provenance frontmatter
(`installed-by agentconfig from <source>@<version>`).

### Sessions & analytics

- **Dashboard** — activity computed from real session history: counts, streaks, an
  activity heatmap, and an achievements catalog.
- **Sessions** — step through past sessions from the JSONL adapters; tags,
  markdown export, pagination, and a live-session pulse for a session currently
  growing on disk. Subagent (sidechain) entries render distinctly.
- **Search** — full-text search over turns and tool results (requires the optional
  `better-sqlite3`; see below).
- **Context health** — config size budgets, largest contributors, and
  optimization suggestions.

### Operate

- **Git** — branch switcher, grouped changes (modified/added/deleted/untracked), a
  conventional-commit helper, and push/pull, scoped to the launched repo and
  refreshed by the watcher.
- **Terminal** — a multi-tab PTY (xterm.js) over an authenticated WebSocket that
  can launch any detected runtime's CLI. Requires the optional `node-pty`.

### Pipelines

A React Flow builder with 14 node types (prompt, bash, github-action, http,
transform, delay, input, output, git, filter, read-file, write-file,
notification, json-extract), `{{input}}` / `{{NodeName}}` templating, async
execution with live node status, and run history. Cron and preset scheduling are
executed by the headless daemon.

```bash
agentconfiging daemon          # run the scheduler until stopped
agentconfiging daemon --once   # fire every currently-due pipeline once, then exit (cron-friendly)
```

The daemon emits plain timestamped lines and never opens a PTY.

## `report` in CI

```bash
agentconfiging report            # compact JSON to stdout
agentconfiging report --pretty   # indented
agentconfiging report ./path     # a specific root
agentconfiging report --global   # also include global config dirs (local-only)
```

Exit code reflects the most severe finding — `0` clean, `1` warning, `2` error,
`3` engine failure, `64` usage error — so it gates a build directly. The report
never contains file contents; machine fixes are summarized as `hasFix` / `fixKind`
rather than serialized. `--global` entries are flagged `localOnly` and must not be
uploaded.

## Optional native modules

Two dependencies are optional and the app degrades gracefully without them:

| Module | Powers | Without it |
|---|---|---|
| `better-sqlite3` | full-text session search | search is unavailable; all else works |
| `node-pty` | embedded terminal | terminal is unavailable; all else works |

The core `npx` launch never requires either.
