# agentconfig.ing — Product & Architecture Spec (v1)

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

#### 4.1.1 Agent profiles: upstream runtime knowledge

An **`AgentProfile`** is the versioned, evidence-backed description of an agent
runtime's upstream configuration contract. It answers questions such as “which
files and settings does this version of Codex understand?” It does **not** say
that the runtime is installed in the current workspace and it does not contain
the user's configuration values.

This gives three deliberately separate concepts:

| Concept | Describes | Produced/owned by | Example |
|---|---|---|---|
| `AgentProfile` | What an upstream runtime supports | Canonical profile registry, after review | Codex reads `AGENTS.md`; `config.toml` has a `model` key |
| `DetectedAgent` | Evidence found in one local scan | Detector execution | `.codex/config.toml` was found; confidence is `high` |
| Install provenance | Which catalog operation wrote a local artifact | Registry install flow | skill installed from source X at version Y |

The word **confidence** is scoped accordingly. Profile fact confidence measures
the strength of upstream evidence (`verified`, `corroborated`, `inferred`, or
`unknown`). `DetectedAgent.confidence` remains the unrelated `low | medium |
high` count-signals heuristic. Install provenance is a receipt, not confidence.

##### Profile roster and coverage

The initial roster is the 15 runtimes already represented by the runtime
knowledge table. Eight are **first-class** (detector plus profile): Aider, Claude
Code, OpenAI Codex, Continue, GitHub Copilot, Cursor, Gemini CLI, and opencode.
Seven are initially **profile/sync-only**: Amazon Q Developer, Cline, JetBrains
Junie, Qodo, Roo Code, Windsurf, and Zed. A profile records coverage for each
capability area as `full`, `partial`, `unknown`, or `unsupported`; absence of a
fact never means that the upstream runtime lacks the capability.

Adding a roster entry requires a stable kebab-case id, display name, vendor,
product/release sources, at least one official configuration source, an owner,
and explicit coverage. For first-class runtimes the id must equal the detector
id. Renames preserve the old id as an alias; ids are not recycled.

##### Contract and revisioning

A canonical profile contains:

- identity: stable id, aliases, display name, vendor, product family, and support
  tier;
- sources: stable source ids, authoritative URLs or CLI/schema probes, source
  kind, retrieval policy, and latest successful retrieval metadata;
- artifacts: paths, format, project/global scope, precedence/load behavior, and
  platform applicability;
- capabilities: settings (key path, type, default, enum), models, tools, hooks,
  commands, instructions/rules, skills, MCP, extensions, and history surfaces;
- lifecycle: `current`, `legacy`, `deprecated`, or `removed`, with replacement
  and version bounds when known;
- evidence and applicability on every factual leaf; and
- coverage, freshness status, and audit metadata.

`schemaVersion` versions the shape and interpretation of profile documents. It
changes only when readers need migration logic. `profileRevision` is a
monotonically increasing integer for the canonical content of one runtime; it
increments whenever promoted facts, evidence, or maintainer policy change.
`observedProductVersion` and per-fact applicability describe the vendor product
and never substitute for either revision. Generated candidates retain
`basedOnProfileRevision` so stale proposals cannot overwrite newer canonical
work.

Every factual leaf is an object rather than an unexplained scalar. Its common
envelope is:

```ts
type ProfileFact<T> = {
  factId: string;
  value: T;
  lifecycle: 'current' | 'legacy' | 'deprecated' | 'removed';
  replacementFactId?: string;
  applicability: {
    since?: string;
    until?: string;
    channels?: ('stable' | 'beta' | 'nightly')[];
    platforms?: ('darwin' | 'linux' | 'windows')[];
    interfaces?: ('cli' | 'ide' | 'desktop' | 'web')[];
    observedFrom?: string;
    observedUntil?: string;
  };
  evidence: Array<{
    sourceId: string;
    locator: string; // heading, JSON pointer, CLI probe, or release-note anchor
    checkedAt: string;
    contentHash?: string;
  }>;
  confidence: 'verified' | 'corroborated' | 'inferred' | 'unknown';
  lastChangedAt?: string;
};
```

`factId` is an immutable, runtime-local, kebab-case identifier assigned when a
fact is first promoted (for example `instruction-project-claude-md`). It is
independent of array position and of every mutable field, including `value`,
path, lifecycle, and applicability. Extractors match candidates to existing
facts by `factId`; changing a value preserves the id, while splitting one fact
creates new ids and retires the original. Deleted ids are tombstoned and never
reused. Canonical arrays are normalized by `factId`, then evidence by
`sourceId`/`locator`, so source or extraction order cannot create a diff.

`verified` requires a current official source or vendor-distributed schema/CLI
probe. `corroborated` requires consistent independent evidence when no adequate
official source exists. `inferred` is useful for review but cannot authorize a
destructive migration or a claim that a feature was removed. `unknown` records
the gap explicitly. Conflicting sources remain separate evidence records and
produce an audit warning; extraction must not silently choose one.

Evidence uses canonical wire formats. `checkedAt`, `lastChangedAt`, retrieval,
and promotion times are UTC RFC 3339 timestamps with seconds and `Z` (for
example `2026-07-26T00:00:00Z`). `contentHash` is lowercase
`sha256:<64-hex-digits>` over the exact retrieved bytes before parsing. A
`locator` is source-kind-specific and stable: an RFC 6901 JSON Pointer for
JSON/schema, a normalized URL fragment for HTML/Markdown headings, or
`command:<argv>#<output-section>` for a pinned CLI probe. Empty or line-number-
only locators are invalid. Source ids and fact ids are lowercase kebab-case.

##### Lifecycle and applicability semantics

Lifecycle values describe vendor support, not our coverage:

- `current`: documented and supported for at least one declared applicability;
- `legacy`: still supported, but superseded for new configuration;
- `deprecated`: vendor says it remains accepted temporarily and should be
  migrated; a replacement is required when the vendor names one; and
- `removed`: affirmatively unsupported for the declared versions, retained as a
  tombstone so diagnostics can explain old configuration.

Normal transitions are `current -> legacy -> deprecated -> removed`, but vendor
evidence may skip stages. Any transition requires affirmative evidence; moving
back to `current` or `legacy` is a restoration and requires new authoritative
support evidence. `replacementFactId`, when present, is a `factId` in the same
profile (or `runtime-id/fact-id` across profiles), must resolve, must not itself
be `removed`, and is forbidden when the vendor gives no replacement. `since` is
the first inclusive supporting product version and `until` is the last
inclusive supporting version; an open bound means unknown/unbounded, never the
current profile revision. Version strings must be exact vendor versions and are
compared with the source's declared version scheme (`semver`, `calver`, or
`opaque`); opaque versions support equality only.

Applicability is conjunctive across dimensions and disjunctive within a list:
a fact matches only when version **and** channel **and** platform **and**
interface match. An omitted dimension means all values; an explicitly empty
list is invalid. Stable is not implied by beta/nightly, `cli` is not implied by
`ide`, and aliases are normalized by a maintainer-owned enum before matching.
For rolling products without addressable releases, sources declare
`versionScheme: rolling`; every fact supported by that source must omit version
bounds and carry a UTC observation window (`observedFrom` required and inclusive,
`observedUntil` optional and exclusive) in `applicability`. Both use the same
canonical RFC 3339 format as other timestamps, and `observedUntil` must be later
than `observedFrom`. Facts backed by versioned sources must omit both observation
fields. Such rolling facts describe observed behavior, not historical version
support. Overlapping facts for the same capability/applicability are invalid
unless their values are identical.

##### Maintainer scaffold versus discovered facts

Some useful runtime-table fields are product policy, not discoverable upstream
facts. `scaffoldPath`, `scaffoldTemplate`, preferred write target, detector
mapping, support tier, profile owner, source allowlist, and freshness overrides
are **maintainer-owned scaffold fields**. Scheduled extraction may report that
they appear inconsistent, but may not rewrite them. Upstream facts such as
documented paths, formats, precedence, setting keys, defaults, hook events, and
model lifecycle belong in evidence-backed profile facts. Consumers derive the
existing runtime instruction table and other catalogs from the promoted profile
plus its maintainer scaffold; executable parsers and detectors remain code.

##### Freshness SLOs

Freshness is computed per source and rolled up per capability; the oldest
required source determines the profile status. A source declares the capability
areas it covers and `required: true | false`; every capability with coverage
`full` or `partial` must have at least one required source. Maintainers designate
required sources based on authority and completeness; extractors cannot change
that choice. When multiple required sources cover a capability, precedence is
vendor schema/CLI inventory, then official configuration reference, then
official release notes; lower-precedence sources may add evidence but cannot
silently override a conflict. The capability rollup is the worst state among
its required sources (`fresh < stale < expired < unavailable`), and the profile
rollup is the worst capability state, excluding capabilities explicitly marked
`unsupported`. An optional-source failure is reported but does not degrade the
rollup.

Default maximum age since the
last successful substantive check is 7 days for release feeds/vendor schemas,
14 days for configuration references and model/tool/hook catalogs, and 30 days
for stable instruction-path documentation. Maintainers may only tighten these
defaults or document a runtime-specific exception. At 100% of the maximum age a
source is `stale`; at 200% it is `expired`. A failed or blocked fetch is
`unavailable`, not evidence of removal, and never advances `checkedAt`.

Cheap metadata checks may run daily, full authoritative-source extraction runs
weekly, and a clean-cache deep audit runs monthly. A metadata response only
advances the retrieval timestamp; it advances a fact's `checkedAt` only when the
source content or an equivalent immutable artifact was actually revalidated.

##### Candidates, review, and promotion

Canonical profiles are read-only inputs to scheduled jobs. Fetchers store
bounded, hashed evidence; deterministic extractors and optional bounded model
extraction write a separate **candidate** containing the base revision, source
snapshot ids, semantic diff, validation result, and extraction diagnostics.
Automation never edits canonical files directly.

Promotion requires schema validation, deterministic normalization, a semantic
diff, tests for affected projections, and human review. A reviewer must verify
new or changed claims against their cited evidence, resolve source conflicts,
and explicitly approve lifecycle transitions. `removed` requires affirmative
authoritative evidence: an official removal statement, or a successful query of
a vendor-declared comprehensive versioned inventory that explicitly reports the
fact unsupported. Repeated absence, even across successful audits, is never
enough; fetch failure, 404, parsing failure, or omission from a non-comprehensive
source is also insufficient. Security-
sensitive defaults, write paths, permission semantics, and executable hooks
require two independent maintainer approvals. Each approval record contains
`approverId`, `approvedAt`, `candidateId`, `candidateHash`,
`basedOnProfileRevision`, `decision` (`approve` or `reject`), and optional
`comment`; duplicate approver ids count once, and any rejection blocks
promotion until superseded by a new candidate. Promotion is atomic, increments
`profileRevision`, records all approval records plus promoter id/time and the
resulting canonical hash, and rejects a candidate whose base revision or hash is
no longer current.

##### Worked profile slices

These abbreviated examples show the boundary; they are illustrative profile
slices, not the seed data implemented by the next task:

```yaml
id: claude-code
schemaVersion: 1
profileRevision: 1
sources:
  - id: claude-memory-docs
    kind: official-docs
    url: https://docs.anthropic.com/en/docs/claude-code/memory
    required: true
    covers: [instructionArtifacts]
    versionScheme: rolling
  - id: claude-hooks-docs
    kind: official-docs
    url: https://docs.anthropic.com/en/docs/claude-code/hooks
    required: true
    covers: [hookEvents]
    versionScheme: rolling
maintainer:
  supportTier: first-class
  detectorId: claude-code
  owner: runtime-maintainers
  scaffoldPath: CLAUDE.md
facts:
  instructionArtifacts:
    - factId: instruction-project-claude-md
      value: { path: CLAUDE.md, format: markdown, scope: project }
      lifecycle: current
      applicability: { interfaces: [cli], observedFrom: "2026-07-26T00:00:00Z" }
      evidence:
        - { sourceId: claude-memory-docs, locator: "#claude-md", checkedAt: "2026-07-26T00:00:00Z" }
      confidence: verified
  hookEvents:
    - factId: hook-event-pre-tool-use
      value: PreToolUse
      lifecycle: current
      applicability: { interfaces: [cli], observedFrom: "2026-07-26T00:00:00Z" }
      evidence:
        - { sourceId: claude-hooks-docs, locator: "#pretooluse", checkedAt: "2026-07-26T00:00:00Z" }
      confidence: verified
```

```yaml
id: codex
schemaVersion: 1
profileRevision: 1
sources:
  - id: codex-instructions-docs
    kind: official-docs
    url: https://developers.openai.com/codex/guides/agents-md
    required: true
    covers: [instructionArtifacts]
    versionScheme: rolling
  - id: codex-config-reference
    kind: official-docs
    url: https://developers.openai.com/codex/config-reference
    required: true
    covers: [settings]
    versionScheme: rolling
maintainer:
  supportTier: first-class
  detectorId: codex
  owner: runtime-maintainers
  scaffoldPath: AGENTS.md
facts:
  instructionArtifacts:
    - factId: instruction-project-agents-md
      value: { path: AGENTS.md, format: markdown, scope: project }
      lifecycle: current
      applicability: { interfaces: [cli, ide], observedFrom: "2026-07-26T00:00:00Z" }
      evidence:
        - { sourceId: codex-instructions-docs, locator: "#agents-md", checkedAt: "2026-07-26T00:00:00Z" }
      confidence: verified
  settings:
    - factId: setting-model
      value: { path: model, type: string, artifact: "~/.codex/config.toml" }
      lifecycle: current
      applicability: { interfaces: [cli], observedFrom: "2026-07-26T00:00:00Z" }
      evidence:
        - { sourceId: codex-config-reference, locator: "#model", checkedAt: "2026-07-26T00:00:00Z" }
      confidence: verified
```

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
  (`installed-by agentconfig.ing from <source>@<version>` frontmatter), so upgrade/
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
| 12 | Pipelines | Visual workflow builder (React Flow): 14 node types (prompt, bash, github-action, http, transform, delay, input, output, git, filter, read-file, write-file, notification, json-extract), `{{input}}`/`{{NodeName}}` templating, async execution with live node status, run history + replay, cron + preset scheduling; scheduler lives in `agentconfiging daemon` since npx sessions are ephemeral. | E9 |
| 13 | Session replay | Browse and step through past sessions from the JSONL adapters (§3); tags, markdown export, paginated large sessions, live-session detection with signal pulse; subagent (sidechain) entries rendered distinctly. | E7 |
| 14 | Templates gallery | 30+ starter configurations across skills/agents/rules/hooks/MCP, shipped as `template`-tagged registry entries; quick-add reachable from every relevant editor page. | E6 |
| 16 | Context health | Config size budgets, largest context contributors, optimization suggestions; storage maintenance. | E7 |
| 17 | Session search | Full-text search over turns and tool results (SQLite FTS5) with reindex + coverage stats; embeddings-based semantic mode behind an opt-in flag. | E7 |
| 18 | Command palette | Cmd+K fuzzy palette: jump to any page, toggle theme, run actions; keyboard nav; Cmd+1..9 page shortcuts shared with rail numbering. | E10 |
| 19 | Keybindings editor | Visual editor for `~/.claude/keybindings.json`: combos, commands, conditions, chord support, reset to defaults. | E5 |
| 20 | Onboarding & theming | First-run guided setup, persisted Paper/Ink theme preference, about dialog. | E10 |
| 21 | Freshness & always-on | `npx` always runs the latest release; update-notifier for global installs; `agentconfiging daemon` covers always-running needs (schedulers) with no desktop app required. | E11 |
| 22 | Instruction sync | Designate a source-of-truth instruction file/directory; regenerate every other runtime's instruction files from it (diff-previewed like all writes); per-runtime sync-status indicators; one-click resolve on instruction-drift findings. Long-tail runtime formats (Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo) supported as sync targets even where full detection isn't built. | E5 |
| 23 | Instance management | Lazy multi-root workspace (§4.2): launch in one folder, add folders individually, or recursively discover agent-configured projects under a directory; instances load on first open and persist across launches; switch instances from CLI, web UI, and command palette. | E2, E4 |
| 24 | Ink CLI | Interactive terminal UI (Ink): instance list with status, live log pane, add/scan actions mirroring the web UI's instance management; all logs also written to `~/.local/state/agentconfiging/logs/`. `report` stays plain JSON for CI. | E2 |

## 6. Milestones / Epics

- **E0 Scaffold** — repo layout, toolchain (tsup, vite, vitest, eslint+prettier), CI, fixture corpus harvested from real repos.
- **E1 Core engine** — scanner, manifest, parsers, detectors, analyzers, report, fix model, history readers. *Demo: `agentconfiging report` prints full JSON for any repo.*
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
