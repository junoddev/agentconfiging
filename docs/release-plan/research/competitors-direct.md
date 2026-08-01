# Direct Competitors — AI Agent Configuration Tools (mid-2026)

Research date: 2026-08-01. Scope: tools whose core job is managing, inspecting, syncing, or
analyzing AI coding-agent configuration. Adjacent categories (session analytics, config linters)
are included because agentconfiging bundles those jobs (features 3, 7) and competes there too.

Traction figures are approximate, drawn from GitHub/npm at time of research — treat as directional.

## Comparison table

| Tool | Type | Runtimes covered | Traction | Core job | Does something agentconfiging does NOT |
|---|---|---|---|---|---|
| **rulesync** (dyoshikawa) | CLI | 40+ (Claude, Copilot, Cursor, Cline, Gemini/Antigravity, Codex, JetBrains AI, Devin, Goose…) | ~1.3k stars; the dominant sync package by npm downloads | Generate per-tool config from unified rule files; rules + MCP + commands + subagents + skills + ignore + hooks | Far broader runtime list; bidirectional import/export; distributes commands/subagents/hooks/permissions across tools |
| **Ruler** (intellectronica) | CLI | 30+ (Copilot, Claude, Cursor, Windsurf, Cline, Aider, Codex, Jules, Amp, Antigravity, Amazon Q, Gemini, Junie, Augment, Kilo, OpenCode, Goose, Qwen, RooCode, Zed, Trae, Warp, Kiro, Factory, Mistral…) | ~2.8k stars (scoped npm pkg low weekly downloads) | `.ruler/` source dir → distribute to every agent; MCP via `ruler.toml`; skills; subagents; auto-gitignore; **nested/monorepo rule loading** | Nested per-directory rule loading; `ruler revert`; broadest runtime list; MCP propagation via TOML |
| **claude-code-templates** (davila7) | CLI + hosted web catalog (aitmpl.com) | Claude Code-centric | **~30k stars, 3.3k forks** — by far the largest | Component marketplace (1000+ agents/commands/MCPs/hooks/skills) + analytics dashboard + plugin dashboard + health check + mobile conversation monitor | Huge entrenched catalog w/ network effect; mobile/remote session monitor via Cloudflare Tunnel; E2B/Workers execution sandboxes |
| **agent-skills-manager** (umutbozdag) | **GUI dashboard** (Next.js/React) + built-in terminal | 11 (Cursor, Claude, Windsurf, Copilot, Codex, Cline, Aider, Continue, Roo, Augment, Agents) | ~27 stars (new) | Visual dashboard to discover/edit/enable/install/move/delete **skills** (+ rules), bulk ops | Nearest GUI analog conceptually, but skills-scoped; enable/disable + bulk move/delete of skills |
| **dotagents** (iannuttall) | CLI (symlink) | 6 (Claude, Cursor, Factory, Codex, OpenCode, Gemini) | ~703 stars | `.agents/` canonical folder symlinked to each tool; md + commands + hooks + skills; auto-backup | Pure symlink model (no codegen), so edits are instantly live everywhere with zero regeneration |
| **agentlink** (multiple forks: martinmose, snapsynapse, digimetalab) | CLI (symlink) | AGENTS.md/CLAUDE.md/GEMINI.md; digimetalab fork does MCP config | small/varied | One real file, many symlink aliases; "no codegen" | Symlink philosophy; digimetalab variant is a dedicated **MCP config** linker |
| **dot-agents / .agents Protocol** (dot-agents.com, dotagentsprotocol.com) | CLI + emerging **standard** | Claude, Codex, Factory, Cursor, OpenCode, Gemini | new | Canonical `.agents` folder + a proposed open standard unifying MCP/AGENTS.md/skills/memories | Attempting to define a config *standard*, not just a tool |
| **AGENTS.md + "Sync AI Agent Rules" GH Action** | GitHub Action | Claude, Copilot, Codex, Gemini, Cursor, Windsurf | marketplace-listed | CI-side rule fan-out from AGENTS.md | Purpose-built CI Action packaging |
| **AgentLinter** (seojoonkim / agentlinter.com; also Codacy) | CLI + GH Action + web reports (+ Codacy platform) | CLAUDE.md, AGENTS.md, .cursorrules, Copilot, skills, OpenClaw/Moltbot | ~77 stars; Codacy platform distribution | **Lint** agent config: 8-dimension 0–100 scoring, 100+ patterns; secrets, **token-efficiency, position-risk, clarity/vague-language, cross-file contradictions**; `--fix` | Content-quality checks (token budget, "buried critical rule" position risk, vague-language, cross-file contradictions) + numeric scoring + Codacy CI integration |
| **AgentLint** (agentlint.app) | GH Action / CLI | CLAUDE.md/AGENTS.md/harness | marketplace-listed | 42 evidence-backed checks across 6 dimensions: "how agent-ready is this repo" | Repo agent-readiness scoring framing |
| **AgentEval** (Lukas Metzler) | Self-contained Bun binary | AI config files | new | Static analysis, no Node runtime | Zero-runtime single-binary distribution |
| **Claudoscope** (claudoscope.com) | **Native macOS menu-bar app** | Claude Code + Cowork | free/MIT | Session browse + cost analytics + **secret detection** + **13 drift/hardening checks** + config/skills/MCP viewer (read-only + reversible hardening) | Native OS-integrated menu-bar UX; unified Claude Code+Cowork spend; one-click reversible security hardening baseline |
| **claude-view** | Rust dashboard | Claude Code | active | Real-time monitor: sessions, cost, tokens, sub-agent trees, 85 MCP tools, full-text search | Rust perf; large MCP-tool surface; sub-agent tree viz |
| **Claude Replay** (constripacity) | Web dashboard + TUI | Claude Code | active | Observability: full-text search, session diffing, death-cause classification, checkpoint/recovery, 5 MCP tools | Session diffing + "death-cause" classification + checkpoint/resume |
| **claude-replay** (es617) / **vibe-replay** | CLI → HTML | Claude, Cursor, Codex, Gemini, OpenCode, Kimi | active | Turn sessions into shareable self-contained HTML replays | Shareable single-file HTML replay export |
| **claude-code-history-viewer** (jhlee0409) | Electron desktop app | Claude Code | active | Browse/search stored conversations w/ markdown+syntax rendering | Native desktop history browser |

## Per-tool notes

### Sync-first CLIs (the core "write once, distribute everywhere" category)

- **rulesync** — https://github.com/dyoshikawa/rulesync — The de-facto leader of the sync category
  by adoption. Node CLI, npm/Homebrew/single-binary. Covers 40+ platforms and, importantly, syncs
  more than instruction text: rules, MCP, commands, subagents, skills, ignore files, hooks, and
  permissions. Supports bidirectional import/export and format conversion without requiring its own
  `.rulesync/` workflow. This is the tool agentconfiging's sync feature (5) most directly overlaps —
  and rulesync out-covers agentconfiging on raw runtime breadth.
- **Ruler** — https://github.com/intellectronica/ruler — https://github.com/intellectronica/ruler —
  ~2.8k stars, MIT, actively developed (1000+ commits). `.ruler/` markdown source, `ruler init/apply/revert`.
  Distinguishers vs rulesync: **nested rule loading** (per-directory context in monorepos), MCP via
  `ruler.toml`, and an explicit `revert`. Scoped npm package shows low weekly downloads, so stars overstate
  active install base. Runtime list is the broadest of anyone (30+ named agents).
- **dotagents** — https://github.com/iannuttall/dotagents — ~703 stars. Symlink model (no codegen):
  `.agents/` is the single source, symlinked into each tool's location, with auto-backup. Covers md +
  commands + hooks + skills for 6 tools. Represents the "symlink not generate" philosophy agentconfiging's
  write-back approach does not offer.
- **agentlink** (martinmose/snapsynapse/digimetalab) — https://github.com/martinmose/agentlink ,
  https://agentlink.run/ — symlink aliasing of AGENTS.md/CLAUDE.md/GEMINI.md; the digimetalab fork is a
  dedicated **MCP config** linker across Claude/Gemini/OpenCode/Codex.
- **dot-agents / .agents Protocol** — https://www.dot-agents.com/ , https://dotagentsprotocol.com/ —
  notable because it is trying to standardize the config directory itself (MCP + AGENTS.md + skills +
  memories), not just ship a tool. Worth watching as a spec risk/opportunity.
- Also-rans in the same lane: PanisHandsome/ai-rules-sync, yelmuratoff/agent_sync, lbb00/ai-rules-sync
  (adds **team/shared rules over a git repo** — a collaboration angle most others lack), jpcaparas/rulesync.

### Catalog / marketplace

- **claude-code-templates** (davila7) — https://github.com/davila7/claude-code-templates ,
  https://aitmpl.com — **~30k stars**, the elephant. It is Claude-centric but overlaps agentconfiging on
  three of its pillars at once: a large component **marketplace** (feature 6), an **analytics dashboard**
  (feature 7), and a plugin/permission **management UI**. Also has a health-check "analyzer" and a
  mobile/remote conversation monitor. It is the single biggest competitive gravity well; any positioning
  must account for it. Its weakness vs agentconfiging: single-runtime (Claude), no cross-runtime sync, no
  visual write-back editors for settings/hooks/keybindings, and catalog installs without agentconfiging's
  checksum/provenance framing.

### GUI config managers

- **agent-skills-manager** (umutbozdag) — https://github.com/umutbozdag/agent-skills-manager — the only
  other genuine web GUI in this space (Next.js 16/React 19/CodeMirror/xterm.js). But it is skills-first
  (plus rules) across 11 tools, ~27 stars, very early. Its existence validates the "visual dashboard for
  agent config" thesis; its narrowness shows nobody has yet shipped the full-breadth UI agentconfiging is.

### Config linters / analyzers (overlaps agentconfiging feature 3 + 11)

- **AgentLinter** — https://github.com/seojoonkim/agentlinter , https://agentlinter.com/ , and the
  Codacy productization https://blog.codacy.com/introducing-agentlinter-codacy-now-scans-your-ai-agent-config-files —
  the most direct competitor to agentconfiging's 13 analyzers. "ESLint for AI agents": 8-dimension 0–100
  scoring, 100+ patterns, `--fix` auto-remediation, CLI + GH Action + hosted web reports, and now bundled
  into Codacy's platform (enabled by default on new repos → serious distribution). Critically it checks
  **content-quality dimensions agentconfiging may not**: token-budget/bloat, "position risk" (critical rules
  buried mid-file where LLMs miss them), vague-language/clarity, and cross-file contradictions.
- **AgentLint** — https://www.agentlint.app/ — 42 checks / 6 dimensions, marketplace GH Action, framed as
  repo "agent-readiness" scoring.
- **AgentEval** (Lukas Metzler) — self-contained Bun binary, no Node needed; the "harness engineering" CI lane.

### Session analytics / replay (overlaps agentconfiging feature 7)

- **Claudoscope** — https://claudoscope.com/ — closest security-and-visibility overlap: native macOS
  menu-bar app, session browse, cost analytics, **secret detection**, and **13 drift/hardening checks** with
  one-click reversible hardening. Read-only by design (except hardening), Claude+Cowork only, no cross-runtime
  sync. Notably its secret detection + 13 checks mirror agentconfiging's redaction + analyzer framing.
- **claude-view** (Rust), **Claude Replay** / constripacity (search, session diffing, death-cause
  classification, checkpoint/recovery), **claude-replay**/es617 + **vibe-replay** (shareable HTML replays),
  **claude-code-history-viewer** (Electron). Collectively these already cover session monitoring, full-text
  search, and shareable replay — agentconfiging's analytics/replay pillar is entering a crowded field.

### Adjacent (not direct, but converging)

- **Mission Control** (builderz-labs) — https://github.com/builderz-labs/mission-control — self-hosted local
  control plane: dispatch tasks, review runs, track spend, **local runtime discovery + configuration views**
  across OpenClaw/Claude Code/Codex. The runtime-discovery + config-view overlap is real; its focus is ops/
  orchestration rather than config authoring.
- **Hermes web dashboard** — localhost control plane (session browser, cron manager, API-key governance with
  redacted previews, log viewer). Overlaps agentconfiging's daemon/cron (feature 9) + redaction framing.
- **Microsoft Agent Control Specification (ACS)** — https://commandline.microsoft.com/agent-control-specification-runtime-governance/ —
  a June-2026 vendor-neutral standard for runtime governance (allow/warn/deny/escalate + redaction effects).
  Not a competitor, but a governance standard agentconfiging may eventually want to speak to.

## Feature gaps in agentconfiging suggested by this landscape

1. **Runtime breadth for sync.** rulesync (40+) and Ruler (30+) cover many runtimes agentconfiging's
   sync targets omit — Aider, Goose, Amp, Factory/Droid, Kiro, OpenCode, Warp, Trae, Kilo, Qwen, Antigravity,
   JetBrains AI, Jules, Augment, Mistral Vibe. If sync (feature 5) is a headline, the target list needs to
   approach parity or agentconfiging looks narrow next to the incumbents.
2. **Distributing more than instruction text.** rulesync/Ruler fan out MCP, slash commands, subagents,
   hooks, ignore files, and permissions across runtimes. agentconfiging edits these but it is unclear it
   *syncs commands/subagents/hooks* cross-runtime the way the leaders do. That is the expected shape of "sync."
3. **Content-quality analyzers.** AgentLinter/Codacy have made token-efficiency, "position risk" (buried
   critical rules), vague-language/clarity, and cross-file contradiction checks table stakes, plus a numeric
   0–100 score. If agentconfiging's 13 analyzers are mostly structural/security, add these prompt-quality
   checks and a headline score to stay competitive on the analyzer pillar.
4. **Nested / monorepo rule loading.** Ruler's per-directory context loading is a concrete capability for
   large repos; agentconfiging should confirm directory-scoped instruction files are first-class.
5. **A packaged GitHub Action for `report`.** AgentLint, AgentLinter, and "Sync AI Agent Rules" are all
   marketplace-listed Actions. agentconfiging has CI-safe `report` with exit codes but needs the Action
   wrapper to actually appear where teams shop for CI checks.
6. **Team/shared config over git.** lbb00/ai-rules-sync and claude-code-templates' catalog both offer a
   sharing/collaboration story; agentconfiging is single-machine. A "share a source-of-truth repo / org
   preset" path is a visible gap.
7. **Symlink option.** dotagents/agentlink users deliberately choose symlinks over codegen for zero-drift,
   instant propagation. Offering a symlink mode (or explaining why write-back is safer) closes an objection.
8. **Remote/mobile visibility.** claude-code-templates and claude-view offer remote/mobile monitoring.
   agentconfiging's localhost-only stance is defensible (privacy) but is a feature gap for some users —
   frame it, don't ignore it.
9. **Secret detection is now table stakes, not a differentiator.** Claudoscope, AgentLinter, and Codacy all
   ship secret scanning. agentconfiging's redaction can no longer be sold as unique; it is expected baseline.

## Positioning implications

1. **Own "integrated control center," because the market is point tools.** No competitor spans detect +
   parse/redact + analyze/fix + visual write-back + cross-runtime sync + marketplace + analytics + pipelines.
   The field is fragmented: sync (rulesync/Ruler), catalog (claude-code-templates), lint (AgentLinter),
   analytics (Claudoscope/claude-view), symlink (dotagents/agentlink). The sharpest message is "stop
   stitching five CLIs together" — one local UI that does the whole loop. This is genuinely defensible today.
2. **Lead with multi-runtime + visual editing against claude-code-templates.** It has ~30k stars and network
   effects, but it is Claude-only, catalog/analytics-shaped, and CLI-first with no visual write-back editors
   or cross-runtime sync. agentconfiging should not fight the catalog head-on; it should differentiate on
   breadth (all runtimes), safety (diff-previewed fixes, checksum/provenance installs), and the visual
   settings/hooks/MCP/keybindings editors it doesn't have.
3. **Don't out-breadth rulesync on pure sync — subsume sync into a workflow.** rulesync owns sync mind-share
   and downloads. Reframe sync as one step inside detect → inspect → analyze → fix → edit → sync, where the
   surrounding context (redaction, analyzers, editors, diff preview) is the value. Still, close enough of the
   runtime-coverage gap that a rulesync user doesn't see agentconfiging as a downgrade on their core job.
4. **Center AGENTS.md as the source of truth.** The AGENTS.md spec is now co-backed by OpenAI/Google/
   Anthropic/Cursor/Factory/Sourcegraph and is the de-facto standard. Being explicitly AGENTS.md-spec-aware
   (and translating to/from CLAUDE.md etc.) is expected; leaning into it signals credibility.
5. **The visual pipeline builder and full-breadth GUI are the true white space.** agent-skills-manager (27
   stars, skills-only) is the only other GUI, and *nobody* has a visual pipeline builder with cron/daemon.
   These are the least-contested, most demo-able differentiators — feature them prominently, likely above the
   sync/lint pillars where incumbents are strong.
6. **Upgrade the analyzers to match the "harness engineering" bar and ship a score.** Add token-efficiency /
   position-risk / clarity / cross-file-contradiction checks and a 0–100 readiness score to neutralize
   AgentLinter/AgentLint, then out-position them with one-click diff-previewed fixes inside a UI (they are
   CLI/CI report tools). "Findings you can actually fix in a click" beats "a lint report."
7. **Privacy/local-only is a real wedge — say it loudly.** Codacy AgentLinter is platform/cloud; many session
   tools phone into dashboards. agentconfiging's no-telemetry, no-account, all-local posture is a
   differentiator against the SaaS-leaning entrants, especially for enterprise/regulated buyers.

## Sources

- https://github.com/dyoshikawa/rulesync
- https://github.com/intellectronica/ruler
- https://www.npmjs.com/package/@intellectronica/ruler
- https://github.com/davila7/claude-code-templates
- https://github.com/umutbozdag/agent-skills-manager
- https://github.com/iannuttall/dotagents
- https://github.com/martinmose/agentlink , https://agentlink.run/ , https://github.com/digimetalab/agentlink
- https://www.dot-agents.com/ , https://dotagentsprotocol.com/
- https://github.com/PanisHandsome/ai-rules-sync , https://github.com/yelmuratoff/agent_sync , https://github.com/lbb00/ai-rules-sync , https://github.com/jpcaparas/rulesync
- https://github.com/marketplace/actions/sync-ai-agent-rules
- https://github.com/seojoonkim/agentlinter , https://agentlinter.com/ , https://blog.codacy.com/introducing-agentlinter-codacy-now-scans-your-ai-agent-config-files
- https://www.agentlint.app/ , https://github.com/marketplace/actions/agentlint
- https://aiproductivity.ai/news/agenteval-linter-ai-coding-instructions/
- https://claudoscope.com/
- https://github.com/es617/claude-replay , https://vibe-replay.com/ , https://github.com/constripacity/Claude-Replay , https://github.com/jhlee0409/claude-code-history-viewer
- https://github.com/builderz-labs/mission-control
- https://commandline.microsoft.com/agent-control-specification-runtime-governance/
- https://agents.md , https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/
