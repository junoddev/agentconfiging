# agentconfiging

**A local control center for your AI agent configuration.** Run `npx agentconfiging`
in any repo and it opens a web UI over the agent setup you're sitting in — every
runtime it detects, every config artifact it parses, every problem it finds — and
lets you inspect, edit, fix, install, and operate your agents. Everything runs on
your machine; nothing is uploaded.

```bash
npx agentconfiging
```

That's the whole install story. The CLI starts a localhost server on a random
port, prints a tokenized URL, and opens your browser. No account, no sign-in, no
hosted component.

---

## What it does

`agentconfiging` scans the repo (and, optionally, your global agent config dirs)
into a structured report, then serves a full control center over it:

- **Inspector** — an overview of every detected runtime with a confidence
  reading, a per-agent detail view, an artifact browser that renders config files
  as text (with secrets redacted server-side before they hit the wire), and a
  findings list from 13 analyzers.
- **Editors (write-back)** — visual editors for `settings.json`, instruction
  files (CLAUDE.md / AGENTS.md / GEMINI.md / `.cursorrules`, with clickable
  `@import` navigation), skills and agents, hooks, rules, memory, MCP servers, and
  `keybindings.json`. Findings that carry a machine-applicable fix get a one-click
  **APPLY** button. Every write is shown as a unified diff before it commits.
- **Instruction sync** — designate a source-of-truth instruction file and
  regenerate the other runtimes' instruction files from it. Long-tail formats
  (Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo) are supported as sync
  targets even where full detection isn't built.
- **Extensions & plugins** — inspect a normalized installed-extension inventory
  across supported runtimes. Claude Code's native plugin marketplace remains a
  separate browse/install experience; Codex configuration and rules are surfaced
  read-only and are not presented as installable Codex plugins.
- **Catalog & marketplace** — browse an installable registry (a 40-entry seed
  snapshot ships in the package for offline first-run) plus the Claude Code plugin
  marketplace. Agentconfig-managed installs are checksum-verified, diff-previewed,
  and stamped with provenance so removal stays traceable. Also scaffolds runtime
  config from templates.
- **Sessions & analytics** — a dashboard of activity computed from real session
  history, redacted session replay, context-health budgets, and full-text
  session search.
- **Operate** — a git panel (branch switcher, grouped changes, commit helper) and
  an embedded multi-tab terminal (xterm.js over an authenticated WebSocket) that
  can launch any detected runtime's CLI.
- **Pipelines** — a visual workflow builder (React Flow) with 14 node types, live
  execution status, run history, and cron scheduling. The scheduler runs headless
  via `agentconfiging daemon`.
- **Live layer** — a file watcher re-runs the engine on change and pushes updates
  over WebSocket, so the UI reflects disk in real time.
- **Power UX** — a Cmd+K command palette, first-run onboarding, persisted
  Paper/Ink theme, and suggestions for other agent-configured projects seen in
  your history.

The design is **Signal Grid**: a strict Swiss-typographic chassis with a live
"broadcast" signal layer (waveform traces, meters, a LIVE dot) that moves only
because something actually happened on disk.

> **Screenshots: TODO.** The UI is best seen live — run `npx agentconfiging` in a
> repo with agent config to see the Signal Grid interface. Static captures will
> land in `docs/images/` (see [docs/images/README.md](docs/images/README.md)).

---

## Commands

| Command | What it does |
|---|---|
| `agentconfiging` | Launch the server + terminal UI and open the browser (default command). |
| `agentconfiging report [path]` | Scan a project and print a JSON report to stdout. Plain, CI-safe — never Ink, never file contents. |
| `agentconfiging daemon` | Run the headless scheduler that fires scheduled pipelines. Plain timestamped output, no UI, no PTY. |

### `report` for CI

`report` prints a compact JSON report and sets its exit code from the most severe
finding, so it drops straight into a pipeline:

```bash
agentconfiging report          # compact JSON, current directory
agentconfiging report --pretty # 2-space indented
agentconfiging report --global # also scan ~/.claude, ~/.codex, ... (local-only output)
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | no findings above info |
| `1` | at least one warning |
| `2` | at least one error |
| `3` | engine failure (structured error JSON on stdout) |
| `64` | usage error |

The report carries paths, metadata, findings, and stats — **never file
contents**. Machine-fix payloads are summarized (`hasFix` / `fixKind`); patch
bodies are never serialized. `--global` output is flagged `localOnly` and must
never be uploaded.

---

## Security & privacy model

A localhost server with filesystem write access and a terminal has to defend
against the browser ecosystem. The model is deliberately conservative:

- **Local by default.** Binds `127.0.0.1` on a random ephemeral port. Pass
  `--accept-all` to explicitly bind `0.0.0.0`, accept any Host/Origin, and print
  token-bearing sample URLs for discovered local hostnames and addresses. This
  exposes the write-capable control center to your network; bearer-token
  authentication remains required. No accounts, no
  telemetry, no upload — nothing leaves the machine.
- **Per-session token.** A bearer token is generated at launch and embedded in
  the opened URL; every API and WebSocket request must present it. Strict
  `Origin`/`Host` checks, no CORS.
- **Guarded writes.** Writes are restricted to known config paths with a
  canonical-path traversal guard; symlinks are not followed out of scope. Every
  write endpoint has a dry-run mode returning a unified diff, and the UI always
  shows that diff before committing. Deletes go to trash, not `unlink`.
- **Secrets redacted before the wire.** Config content is rendered as text nodes
  only (never HTML/eval), and sensitive values are redacted server-side before
  they're sent to the browser.
- **PTY is the highest-privilege surface** and exists only in an interactive
  launch — never in `daemon` mode.

Config, registry, and session content are treated as **adversarial data**:
rendered as text, never interpreted, never followed as instructions.

---

## Supported runtimes

Eight runtimes are auto-detected with a confidence heuristic:

**Claude Code · Cursor · GitHub Copilot · Codex · Continue · Aider · Gemini CLI · opencode**

Instruction sync additionally targets a long tail of formats as data-driven sync
targets, even where full detection isn't built:

**Cline · Windsurf · Zed · Amazon Q · JetBrains Junie · Roo · Qodo**

## Extension support and rollout

The `#/extensions` page is an inventory, not a promise that every runtime has a
plugin manager. “Extension” is the app's normalized display term; the underlying
runtime's name wins in the UI and documentation: Claude calls these **plugins**,
Gemini calls them **extensions**, while Codex's `AGENTS.md`, rules, and config are
**configuration artifacts**, not Codex plugins. Agentconfig's own Catalog is a
separate, provenance-tracked source of installable skills, agents, commands, MCP
servers, and hooks.

Current support is deliberately narrow:

| Provider | Inventory today | Provider-managed install/remove | CLI requirement |
|---|---|---|---|
| Claude Code | Native installed plugins, with scope/version/source/enabled metadata | Marketplace browse and install delegated to `claude`; other lifecycle operations are not yet exposed here | `claude` for marketplace and plugin inventory |
| Codex | Read-only project/global config and rules, including `AGENTS.md` and `.codex/rules/*.rules` | Not supported; Agentconfig Catalog writes are labeled Agentconfig-managed | No `codex` CLI required |
| Cursor, Continue, GitHub Copilot, Aider, opencode | No provider plugin lifecycle adapter yet; their detected config/rules remain available in the normal inspector | Not supported by the Extensions page | No provider CLI required for current inspection |
| Gemini CLI | Planned native extension adapter | Planned lifecycle delegation, with provider-owned install/remove | `gemini` when this adapter ships |

Provider cards distinguish `supported`, `detected`, `unavailable`, `unsupported`,
and `error`. For example, a missing `claude` executable makes the Claude
inventory unavailable; it does not make Claude unsupported. Missing Codex files
produce an unavailable read-only inventory, and no Codex CLI is needed. These
states are intentional so absence of a provider lifecycle is not confused with a
temporary local failure.

### Rollout and known gaps

The first release establishes a safe read-only normalized contract, keeps Claude
marketplace compatibility intact, and adds Codex as the lowest-maintenance
non-Claude inventory. Gemini CLI is the next planned adapter because it has the
clearest native extension lifecycle, but it requires bounded CLI delegation and
additional trust/availability handling. Cursor, Continue, Copilot, Aider, and
opencode remain observe-only candidates until stable provider-owned list/detail
and lifecycle contracts justify an adapter.

Agentconfig does not directly write provider plugin state, execute plugin code, or
invent version/source data. Install/remove support is safe only when a provider's
own lifecycle can be delegated with fixed arguments, timeouts, bounded output,
defensive parsing, and provider-owned uninstall semantics. Until then, use the
Agentconfig Catalog for its explicitly managed artifacts and review its diff and
provenance before writing files.

---

## Requirements

- **Node.js >= 20.19** (CI covers current Node 20.x and 22.x on Linux and macOS)
- **Google Chrome or Chromium** is required only for the real-browser e2e gate:
  `npm run e2e:browser`. Set `CHROME_PATH=/path/to/chrome` when it is not in a
  standard install location.
- Two native modules are **optional** and degrade gracefully when absent:
  - `better-sqlite3` — powers full-text session search. Without it, search is
    unavailable; everything else works.
  - `node-pty` — powers the embedded terminal. Without it, the terminal is
    unavailable; everything else works.

The core `npx` path never requires a native module.

---

## Documentation

- [docs/USAGE.md](docs/USAGE.md) — getting started, commands, feature walkthrough.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the four-layer architecture and
  security model, for contributors.
- [docs/SPEC.md](docs/SPEC.md) — the product & architecture spec (design doc).
- [docs/DESIGN.md](docs/DESIGN.md) — the Signal Grid design system (design doc).

## License

MIT. All feature implementations are original, clean-room work — no code is copied
or ported from third-party tools.
