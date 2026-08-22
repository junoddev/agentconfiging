# Architecture

Contributor-facing overview of how `agentconfiging` is built. This complements the
design docs — [SPEC.md](./SPEC.md) §4 is the authoritative spec; this is a
navigational summary of what shipped.

## Four layers

`agentconfiging` is a single npm package with four internal layers:

```
src/core/    Pure analysis engine. scanner (fs) → Manifest → detect() → analyze()
             → Report. analyze() has zero I/O and is fixture-testable from JSON.
             Also: parsers, session-history readers, registry client, pipeline
             model, instruction-sync engine, runtime knowledge table.
src/server/  Hono on 127.0.0.1:<random port>. REST + WebSocket. chokidar watcher.
             Write API with diff preview. PTY manager (node-pty). Pipeline
             executor + scheduler. Serves the built web UI.
src/cli/     Ink (React for the terminal) + commander. `launch` (default),
             `report` (plain JSON for CI), `daemon` (headless scheduler).
web/         Vite + React + TS single-page app. Bespoke CSS design tokens
             (Signal Grid — no Tailwind/component kit). WS client, xterm.js
             terminal, React Flow pipeline canvas.
```

### Core engine (`src/core/`)

The engine is a pure pipeline: `Manifest → Detectors → Analyzers → Report`. It is
side-effect free (`analyze()` does no I/O) so the whole thing is testable from
JSON fixtures.

- **Scanner** builds a `Manifest` — `{ root, cwdBasename, files: [{path, size,
  sha256, content?}], stats }` — from disk, over both *project* scope (the repo)
  and *global* scope (`~/.claude`, `~/.codex`, …). Global scope is local-only and
  excluded from anything that could leave the machine.
- **Detectors** (`src/core/detectors/`) — 8 runtime detectors (Claude Code,
  Cursor, Copilot, Codex, Continue, Aider, Gemini CLI, opencode), each a
  `{ id, matches(manifest), extract(manifest) }` module returning a
  `DetectedAgent` with a low/medium/high confidence. Modules self-register via
  directory-based auto-discovery (the earlier hardcoded-list approach was a
  documented footgun); a registry test fails if any module isn't wired.
- **Parsers** (`src/core/parsers/`) — YAML frontmatter, TOML, and JSON into typed
  models for subagents, skills, commands, rules, `settings.json`, `.mcp.json` /
  `mcpServers`, `keybindings.json`, memory files, `.cursor/rules/*.mdc`, Copilot
  instructions, `AGENTS.md` / `GEMINI.md`, and `@import` references.
- **Analyzers** (`src/core/analyzers/`) — 13 registered analyzers, each
  `{ id, analyze(report) → Finding[] }`. A finding may carry a machine-applicable
  `fix` (`{ kind, edits: [{path, patch}] }`) that powers one-click APPLY. Model
  staleness lives in a data file, not code. Like detectors, analyzers self-register
  and are auto-discovered.
- **Instruction sync engine** — a bidirectional mapping between runtimes'
  instruction formats. A designated source of truth regenerates the others,
  upgrading drift findings from detection to a one-click resolve. The runtime
  knowledge table (`src/core/runtimes/`) extends beyond the 8 detected runtimes to
  a long tail of sync-only formats (Cline, Windsurf, Zed, Amazon Q, Junie, Roo,
  Qodo) as data.
- **Agent profiles** — the canonical, versioned knowledge layer describing each
  upstream runtime's configuration contract. Each factual leaf carries evidence,
  applicability, lifecycle, confidence, and freshness metadata. Profiles are not
  scan results: detectors combine a profile with a local `Manifest` to produce a
  `DetectedAgent`; catalog provenance separately records files installed by this
  product. Existing instruction-format, settings, model, tool, and hook catalogs
  become projections of promoted profiles rather than competing sources of truth.
  See [SPEC.md](./SPEC.md#411-agent-profiles-upstream-runtime-knowledge) for the
  contract and Claude/Codex examples.
- **History readers** (`src/core/history/`) — parse `~/.claude/history.jsonl` and
  session JSONL into typed session/usage models feeding the dashboard,
  and replay. Read-only and resilient to unknown line types. cwd is read from
  in-file entries, never decoded from the lossy directory slug.

### Profile update boundary

Profiles use two revisions: `schemaVersion` migrates the document shape, while a
per-runtime `profileRevision` advances on each reviewed promotion. Maintainer-owned
scaffolding (templates, preferred write targets, detector mapping, ownership, and
source policy) surrounds evidence-backed upstream facts and cannot be changed by
extractors.

The update path is intentionally one-way and review-gated:

```text
authoritative sources -> hashed evidence -> extraction -> candidate + semantic diff
                                                        |
canonical profile <- atomic human promotion <- validation/tests/review
```

Scheduled jobs never write the canonical registry. Failed sources remain visible
as unavailable/stale and cannot imply removal. Candidate profiles are based on an
explicit canonical revision, so promotion rejects stale concurrent work. The
canonical registry then projects data into runtime consumers; executable detector
and parser behavior stays in code.

### Server (`src/server/`)

A Hono server on `127.0.0.1` at a random port. It exposes REST + WebSocket,
watches config and history files with chokidar (150ms debounce) to re-run the
engine and push structural report diffs live, and hosts the write API, PTY
manager, and pipeline executor/scheduler. It serves the built web UI.

The write API is dry-run-first: every write endpoint can return a unified diff,
which the UI shows before committing. Deletes trash rather than unlink.

### CLI (`src/cli/`)

commander for parsing, Ink for the interactive launch UI. Three commands:

- **`launch`** (default) — start the server, render the instance list + status +
  log pane, open the browser.
- **`report`** — plain JSON to stdout for CI. Never Ink. Exit code reflects the
  most severe finding.
- **`daemon`** — the headless scheduler for scheduled pipelines. Plain output, no
  PTY.

Logs always also land at `~/.local/state/agentconfiging/logs/<timestamp>.log`
(XDG state dir; `AGENTCONFIGING_LOG_DIR` overrides).

### Web (`web/`)

A Vite + React + TypeScript SPA. The Signal Grid design system is bespoke CSS
design tokens — no Tailwind, no component kit. It talks to the server over
token-authenticated REST + WebSocket, embeds xterm.js for the terminal, and uses
React Flow for the pipeline canvas. See [DESIGN.md](./DESIGN.md) for the design
system.

## Security model (SPEC §4.3)

A localhost server that can write files and open a PTY must defend against the
browser ecosystem (DNS rebinding, CSRF from arbitrary web pages):

- **Loopback + random port.** Binds `127.0.0.1` only.
- **Per-session token.** Generated at launch, embedded in the opened URL; required
  on every API/WS request. Strict `Origin`/`Host` checks; no CORS.
- **Path-guarded writes.** Restricted to known config paths (project root + agent
  home dirs), with a canonical-path traversal guard; symlinks are not followed out
  of scope.
- **Diff-first writes.** Every write endpoint has a dry-run mode; the UI shows the
  diff before commit. Deletes go to trash.
- **PTY is the highest-privilege surface** — it exists only in an interactive
  launch, never in `daemon` mode. Pipeline-execution endpoints require the same
  token.
- **Content is adversarial data.** Config, registry, and session content is
  rendered as text nodes only — never HTML/eval, never followed as instructions —
  and secrets are redacted server-side before the wire. Markdown preview is
  sanitized.

## Optional native modules

The core `npx` path never requires a native module. Two are optional and degrade
gracefully:

- `better-sqlite3` — full-text session search (SQLite FTS5).
- `node-pty` — the embedded terminal.

When either is absent, only its feature is unavailable; the rest of the app works.

## Testing

The engine is fixture-driven: tests run against `fixtures/` corpora rather than
mocks, and `analyze()`'s zero-I/O contract means findings are reproducible from
JSON. Detectors, analyzers, and the pipeline model each carry per-module tests;
registry tests enforce that every module file is wired into auto-discovery.
