# agentconfig — Product & Architecture Spec (v1)

Status: agreed direction, 2026-07-26. Companion doc: [DESIGN.md](./DESIGN.md).

## 1. One-liner

`npx agentconfiging` in any repo instantly opens a local web interface showing the AI agent
configuration you're sitting in — every runtime wired up, every artifact parsed, every
problem found — and gives you a full control center to fix, edit, install, and operate
your agents, all without anything leaving your machine.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Architecture | **Fully local.** The CLI starts a localhost server and opens the browser. No accounts, no upload, no hosted component. Catalog is fetched from a static registry index. |
| Write access | **Full read-write.** The UI edits config files, applies fixes, installs/removes artifacts. Every write goes through a diff preview. |
| Catalog scope | **Both shelves**: installable artifacts (subagents, skills, commands, MCP servers, hooks) and runtime setup (scaffold Cursor/Codex/Gemini/etc. config from templates). |
| Feature bar | **Full control center**, not just an inspector: inspection, every config editor, catalog/marketplace, session replay + analytics, git + terminal, and pipelines. The complete feature set is §5. |
| Visual identity | **Swiss × Broadcast** ("Signal Grid") — see DESIGN.md. |
| Language/runtime | TypeScript, Node >= 20. Single published npm package. |

### npm name (decided 2026-07-26)

Package and bin: **`agentconfiging`** — the brand `agentconfig.ing` without the dot,
matching Aaron's existing scoped alias `@capabletooling/agentconfiging`. The bare
`agentconfig` name is held by another author (frozen since 2025-06-17 after they
rebranded their converter; a friendly transfer request remains a future option —
context in bead agentconfig-fy8.3). The install story everywhere is
`npx agentconfiging`.

### License

This project is **MIT** (matching the old umbrella). All feature implementations
must be original work: never copy or port code from third-party tools — especially
copyleft (GPL/AGPL) projects — regardless of feature similarity. Comparable
features in other tools are validation that a market exists, nothing more.

## 3. What we inherit from ../markdowning (and what we don't)

Carry forward (port to TS, mostly as knowledge, some verbatim — the umbrella is ours,
no license issue):

- **Pipeline shape**: `Manifest → Detectors → Analyzers → Report`, pure and
  side-effect free; findings are `{id, severity, agent, title, detail, suggestion}`
  with stable slug ids. (`apps/agentconfig/lib/agentconfig/inspect/`)
- **Path knowledge tables**: `KNOWN_FILES`, `KNOWN_DIRS`, `ALLOWED_EXTS`, `SKIP_DIRS`
  from `cli/src/verticals/agentconfig/scanner.js` — lift verbatim.
- **8 detector signal sets** (Claude Code, Cursor, Copilot, Codex, Continue, Aider,
  Gemini CLI, opencode) + count-signals confidence heuristic; `extras` as an open
  metadata bag.
- **Redaction catalogue** (`cli/src/verticals/agentconfig/redact_patterns.js`) —
  ordered patterns, `sk-(?!ant-)` lookahead, spans tracked next to the regex,
  visible `[REDACTED:*]` marks. In v1 redaction applies to *rendering* of
  sensitive values (nothing is uploaded); keep the catalogue for any future share
  feature.
- **Security instincts**: config content is adversarial data (it is other people's
  prompts) — always render as text, never interpret.
- **`~/.claude/` format notes** from `cli/src/core/agents/adapters/claude_code.js`
  (session JSONL layout, **lossy cwd slugs — read cwd from in-file entries, never
  decode the slug**, sidechain markers, tool-result spill files, ai-title lines) —
  this directly powers Session Replay (§5). Sibling adapters exist
  for codex/gemini/opencode with test fixtures.

Leave behind: the hosted client/server trust machinery (WebSocket bridge, session
tokens, ETS stores, rate limits, mandatory auth), the parallel `workspace` flow,
the umbrella platform coupling, and word-count-as-content heuristics (replaced by
real parsing).

## 4. Architecture

Single npm package, four internal layers:

```
src/core/      Pure analysis engine. scanner (fs) → Manifest → detect() → analyze()
               → Report. analyze() has zero I/O; fixture-testable from JSON.
               Also: parsers, session-history readers, registry client.
src/server/    Hono on 127.0.0.1:<random port>. REST + WebSocket. chokidar watcher.
               Write API with diff preview. PTY manager (node-pty) for the
               terminal. Pipeline executor + scheduler. Serves built web UI.
src/cli/       Ink (React for the terminal) + commander. `agentconfiging`
               (launch: instance list + status + log pane), `report` (JSON to
               stdout for CI — plain, never Ink), `daemon` (headless scheduler).
               Logs always also land on disk at a fixed location:
               `~/.local/state/agentconfiging/logs/<timestamp>.log` (XDG state
               dir; `AGENTCONFIGING_LOG_DIR` overrides).
web/           Vite + React + TS single-page app. Custom CSS design tokens
               (no Tailwind/component kit — Signal Grid is bespoke). WS client,
               xterm.js terminal, React Flow pipeline canvas.
```

### 4.1 Core engine

- `Manifest`: `{ root, cwdBasename, files: [{path, size, sha256, content?}], stats }`.
- `Detector` module interface: `{ id, matches(manifest), extract(manifest) } → DetectedAgent`
  with `{ kind, confidence: low|medium|high, files, extras }`.
  Directory-based auto-discovery of detector/analyzer modules (the Elixir version's
  hardcoded list was a documented footgun).
- **Scopes**: engine runs over *project* scope (repo) and *global* scope
  (`~/.claude`, `~/.codex`, …). Global scope is local-read/write only and excluded
  from anything that could ever leave the machine.
- **Parsers** (the structural core): YAML frontmatter (`yaml`), TOML (`smol-toml`),
  JSON. Structured models for: Claude subagents, skills, commands, rules,
  `settings.json` (permissions, hooks, env, statusLine, model), `.mcp.json` /
  `mcpServers` blocks, `keybindings.json`, memory files (frontmatter type/name/
  description), `.cursor/rules/*.mdc`, Copilot instructions, `AGENTS.md` /
  `GEMINI.md` guides, `@import` references in CLAUDE.md.
- `Analyzer` interface: `{ id, analyze(report) → Finding[] }`. Port the 9 existing
  analyzers where still sensible, upgrade the two word-count heuristics to
  content-aware versions, and add parser-powered ones (subagent references a
  nonexistent tool, MCP command not on PATH, hook script missing, broken @import,
  duplicate/shadowed rules). Model-staleness data lives in a data file, not code.
- Findings may carry an optional machine-applicable `fix`:
  `{ kind, edits: [{path, patch}] }` — powers one-click APPLY in the UI.
- **Instruction sync engine**: a bidirectional mapping between runtimes'
  instruction/rule formats (plain markdown vs. frontmattered, single-file vs.
  rule directories). The user can designate a source of truth (e.g. CLAUDE.md or
  a canonical rules directory) and regenerate the other runtimes' instruction
  files from it. This upgrades the `conflicting-instructions` /
  `rules-drift` findings from detection to a one-click *resolve* action, and
  powers runtime scaffolding (§4.5). The runtime knowledge table extends beyond
  the 8 detected runtimes to the long tail of instruction formats (Cline,
  Windsurf, Zed, Amazon Q, JetBrains Junie, Roo, Qodo) as data files.
- **History readers**: parse `~/.claude/history.jsonl` and
  `~/.claude/projects/<slug>/*.jsonl` into typed session/usage models (feeding
  Dashboard, Session Replay). Read-only, resilient to unknown line
  types.

### 4.2 Workspace model — lazy instances

The app manages **instances**: roots (folders) whose agent config it has loaded.
Nothing is scanned until asked.

- Launching in a folder creates the first instance (cwd). From the CLI or web UI
  the user can **add a folder** (one instance) or **scan a folder recursively**,
  which discovers agent-configured projects underneath it (marker-file walk
  using the detector signal tables, bounded depth, honoring `SKIP_DIRS`,
  never following symlinks) and offers the hits as instances to add.
- Instances load lazily: discovery records only `{root, markers found}`; the
  full engine run + chokidar watcher start on first open/selection, and idle
  instances can be unloaded. One server process hosts all instances; the UI
  switches between them.
- Known-project suggestions (repos seen in `~/.claude/projects`, reading cwd
  from session entries — never the lossy slug) feed the same "add instance"
  flow.
- The instance list persists in `~/.local/state/agentconfiging/workspace.json`
  so the next launch restores it.

### 4.3 Local server & security model

A localhost server with filesystem write access and a PTY must defend against the
browser ecosystem (DNS rebinding, CSRF from random web pages):

- Bind `127.0.0.1` by default, random ephemeral port. The explicit unsafe
  `--accept-all` launch mode binds `0.0.0.0`, accepts arbitrary Host/Origin
  values, and advertises token-bearing sample URLs for locally discovered
  hostnames and addresses; bearer-token authentication remains mandatory.
- Per-session bearer token generated at launch, embedded in the opened URL;
  every API/WS request must present it. Strict `Origin`/`Host` checks; no CORS.
- Writes restricted to known config paths (project root + agent home dirs);
  canonical-path traversal guard; symlinks not followed out of scope.
- Every write endpoint has a dry-run mode returning a unified diff; the UI always
  shows the diff before commit. Deletes go to trash, not unlink.
- PTY and pipeline-execution endpoints require the same token; PTY is the highest
  privilege surface — it exists only when launched interactively, never in
  `daemon` mode.
- Config content rendered as text nodes only, never HTML/eval; markdown preview
  rendered sanitized.

### 4.4 Live layer

chokidar watches config paths and history files (150ms debounce) → rerun engine →
structural diff of reports → push `{type:'report', changed:[...]}` over WS. The
UI's signal elements (traces, meters, LIVE indicator) respond; Broadcast identity
being *true* rather than decorative. Live session detection (a session JSONL
currently growing) gets the pulse treatment.

### 4.5 Catalog & registry

- Registry = a git repo (`agentconfig-registry`) publishing a static `index.json`
  + artifact payloads; fetched over HTTPS with local cache; a seed snapshot ships
  inside the package so the catalog works offline on first run.
- Entry schema mirrors a detected artifact:
  `{ kind, name, description, version, files: [{path, content|url, sha256}], source, tags }`.
  Runtime-setup entries use `kind: 'runtime-template'`. Template-gallery entries
  (starter skills/agents/rules/hooks/MCP configs) are ordinary entries tagged
  `template`.
- Also surface the **Claude Code plugin marketplace** (browse, search, install
  counts, one-click install via the `claude` CLI or direct file writes).
- Install = diff preview → write files → provenance recorded
  (`installed-by agentconfig from <source>@<version>` frontmatter), so upgrade/
  removal are traceable. Checksums verified; registry content is untrusted input.

## 5. Feature set — the control center

The complete v1 feature set. "Epic" points into §6.

| # | Feature | Spec | Epic |
|---|---|---|---|
| 1 | Dashboard | Live stats computed from real session history (`history.jsonl` + session JSONL): session/message counts, streaks, activity heatmap, XP levels, an achievements catalog (19+, data-file-driven). Multi-runtime where history adapters exist. Rendered as Signal Grid stat blocks + heatmap. | E7 |
| 2 | Settings editor | Visual editor for `settings.json` at global and project scope: model selector, effort, permissions editor (allow/ask/deny rules), env vars, statusLine; shared (git-tracked) vs local (gitignored) overrides side by side; storage/disk-usage breakdown with one-click safe cleanup. | E5 |
| 3 | Hooks manager | All hook events (22, kept in a data file to track upstream changes) in a sidebar; create via visual form or quick-add templates (shell command, HTTP webhook, prompt guard, log-to-file); each hook a collapsible card with type/matcher/config. | E5 |
| 4 | Instructions editor | Read/write instruction files at every scope: global + project + `.claude/` CLAUDE.md, CLAUDE.local.md, and — first-class, multi-runtime — AGENTS.md, GEMINI.md, .cursorrules. Edit/preview toggle; clickable `@import` references open in a slide-in panel. | E5 |
| 5 | Memory browser | Card grid over `~/.claude/projects/<slug>/memory/` with type badges (user/feedback/project/reference), name, description, preview; frontmatter editor and create flow. | E5 |
| 6 | MCP manager | CRUD for local `.mcp.json`/`mcpServers` blocks across runtimes, with server templates (filesystem, github, postgres, memory); cloud-configured MCPs shown as read-only cards when discoverable. | E5 |
| 7 | Skills & agents editor | Full editor for SKILL.md / agent .md files; parsed frontmatter as visual cards (model, tools, permissions, hooks, inline MCP); connections view showing relationships (doubles as our config graph); starter templates. | E5 |
| 8 | Rules editor | Contextual rules with path-based filters shown as badges, rendered markdown preview, starter templates; one unified surface covering `.claude/rules` and Cursor `.cursor/rules/*.mdc`. | E5 |
| 9 | Plugins & registry | Browse/search the Claude Code plugin marketplace (install counts, one-click install, installed list with version/scope/date) alongside our own registry (§4.5). | E6 |
| 10 | Git panel | Branch switcher, grouped changes (modified/added/deleted/untracked), conventional-commit helper, push/pull, commit timeline; scoped to the launched repo; refreshes via the watcher, not polling. | E8 |
| 11 | Embedded terminal | node-pty + xterm.js over authenticated WS; multi-tab, sessions persist across navigation; tabs can launch any detected runtime's CLI, not just `claude`; full ANSI rendering. | E8 |
| 12 | Pipelines | Visual workflow builder (React Flow): 14 node types (prompt, bash, github-action, http, transform, delay, input, output, git, filter, read-file, write-file, notification, json-extract), `{{input}}`/`{{NodeName}}` templating, async execution with live node status, run history + replay, cron + preset scheduling; scheduler lives in `agentconfig daemon` since npx sessions are ephemeral. | E9 |
| 13 | Session replay | Browse and step through past sessions from the JSONL adapters (§3); tags, markdown export, paginated large sessions, live-session detection with signal pulse; subagent (sidechain) entries rendered distinctly. | E7 |
| 14 | Templates gallery | 30+ starter configurations across skills/agents/rules/hooks/MCP, shipped as `template`-tagged registry entries; quick-add reachable from every relevant editor page. | E6 |
| 16 | Context health | Config size budgets, largest context contributors, optimization suggestions; storage maintenance. | E7 |
| 17 | Session search | Full-text search over turns and tool results (SQLite FTS5) with reindex + coverage stats; embeddings-based semantic mode behind an opt-in flag. | E7 |
| 18 | Command palette | Cmd+K fuzzy palette: jump to any page, toggle theme, run actions; keyboard nav; Cmd+1..9 page shortcuts shared with rail numbering. | E10 |
| 19 | Keybindings editor | Visual editor for `~/.claude/keybindings.json`: combos, commands, conditions, chord support, reset to defaults. | E5 |
| 20 | Onboarding & theming | First-run guided setup, persisted Paper/Ink theme preference, about dialog. | E10 |
| 21 | Freshness & always-on | `npx` always runs the latest release; update-notifier for global installs; `agentconfig daemon` covers always-running needs (schedulers) with no desktop app required. | E11 |
| 22 | Instruction sync | Designate a source-of-truth instruction file/directory; regenerate every other runtime's instruction files from it (diff-previewed like all writes); per-runtime sync-status indicators; one-click resolve on instruction-drift findings. Long-tail runtime formats (Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo) supported as sync targets even where full detection isn't built. | E5 |
| 23 | Instance management | Lazy multi-root workspace (§4.2): launch in one folder, add folders individually, or recursively discover agent-configured projects under a directory; instances load on first open and persist across launches; switch instances from CLI, web UI, and command palette. | E2, E4 |
| 24 | Ink CLI | Interactive terminal UI (Ink): instance list with status, live log pane, add/scan actions mirroring the web UI's instance management; all logs also written to `~/.local/state/agentconfiging/logs/`. `report` stays plain JSON for CI. | E2 |

## 6. Milestones / Epics

- **E0 Scaffold** — repo layout, toolchain (tsup, vite, vitest, eslint+prettier), CI, fixture corpus harvested from real repos.
- **E1 Core engine** — scanner, manifest, parsers, detectors, analyzers, report, fix model, history readers. *Demo: `agentconfig report` prints full JSON for any repo.*
- **E2 Runtime** — CLI entry, server, security model, WS live updates, watcher. *Demo: npx opens a live-updating raw report.*
- **E3 Signal Grid** — design tokens, type, components, motion primitives, component gallery page, light/dark. *Demo: gallery.*
- **E4 Inspector** — overview dashboard shell, per-agent detail, artifact browser, findings list. *Demo: the product, read-only.*
- **E5 Editors** (write-back) — diff-preview write flow; then settings, instructions (@imports), skills/agents (+connections), hooks, rules, memory, MCP, keybindings editors; APPLY-fix. *Demo: fix a finding and edit every config type from the browser.*
- **E6 Catalog** — registry repo + schema, seed content, templates gallery, browse UI, install/remove/provenance, Claude plugin marketplace, runtime scaffolding templates. *Demo: install a subagent + scaffold Cursor config.*
- **E7 Sessions & analytics** — dashboard stats/streaks/achievements, session replay + search + tags + export, context health, storage maintenance. *Demo: replay yesterday's session.*
- **E8 Operate** — git panel, embedded multi-tab PTY terminal. *Demo: run `claude` inside the app and commit the result.*
- **E9 Pipelines** — React Flow canvas, node library (14 types), executor, run history/replay, cron scheduler + `daemon` mode, schedule logs. *Demo: scheduled pipeline runs headless.*
- **E10 Power UX** — command palette, onboarding, theme persistence, project switcher (other repos seen in `~/.claude/projects`). 
- **E11 Release** — packaging, e2e smoke (npx from tarball), README/docs site, naming decision executed, npm publish.

Dependency spine: E0 → E1 → E2 → E4 → E5 → E6, with E3 parallel to E1/E2 and
feeding E4. E7 needs E1 (history readers) + E4. E8/E9/E10 need E2 + E3. E11 last.
Ship order gates demos: E4 is the first public-worthy build; E5+E6 is "the
configurator"; E7–E9 is "the control center."
