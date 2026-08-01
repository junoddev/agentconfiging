# Vendor / Ecosystem Trajectory — agentconfiging Market Research

**Focus:** What agent-tool vendors and standards bodies have shipped or announced through mid-2026 that overlaps or reshapes a cross-runtime, vendor-neutral config control center. Vendor absorption is the #1 strategic risk; standards shifts (esp. AGENTS.md) change what "sync" means.

**Compiled:** 2026-08-01. All dates and claims cited inline. Sources are secondary/blog-tier unless a primary vendor domain (claude.com, cursor.com, modelcontextprotocol.io, zed.dev, windsurf.com) is noted; treat exact plugin counts and minor version dates as approximate.

---

## 1. AGENTS.md standardization

**Status: this is the single biggest structural threat to instruction-file "sync" as a value prop.**

- Formalized as an open spec **August 2025**, led by OpenAI with Google, Cursor, and Factory participating. Spec **donated to the Linux Foundation's Agentic AI Foundation in December 2025** — i.e., it now has neutral governance, not a single-vendor owner.
  - https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/
  - https://codersera.com/blog/agents-md-complete-guide-2026/
- **Native readers as of May–June 2026:** OpenAI Codex CLI, Cursor, GitHub Copilot coding agent, Windsurf, Sourcegraph Amp, Zed, Warp, Devin, Jules, Junie, goose, Kilo Code, RooCode, Augment Code, Factory, plus Aider and Gemini CLI (configurable). Reported >20 tools and >60,000 repos.
  - https://www.iuriio.com/blog/posts/2026/05/agents-md-field-guide-2026
  - https://asdlc.io/practices/agents-md-spec/
- **The one holdout: Claude Code still reads `CLAUDE.md`, not AGENTS.md** (verified against official memory docs 2026-06-03). The "read AGENTS.md natively" request is Claude Code issue **#6235, 5,270+ reactions, the single largest open feature request, still open mid-2026.**
  - https://gist.github.com/yurukusa/d36197848911f025add142abefcde685
  - https://yurukusa.github.io/cc-safe-setup/agents-md-vs-claude-md.html
- **Does this erode instruction-file sync value? Largely YES, and increasingly.** The dominant recommended pattern is now trivial: make `AGENTS.md` the single source of truth, and bridge Claude Code with a one-line `@AGENTS.md` import in `CLAUDE.md` or a symlink. Every other tool reads AGENTS.md with zero extra config.
  - Free/OSS point solutions already own the residual gap: **Agentlink (launched April 2026)** — "Sync one AGENTS.md to every AI coding tool" via symlinks; symlink cookbooks from SSW.Rules and others.
  - https://agentlink.run/ , https://www.ssw.com.au/rules/symlink-agents-to-claude
- **Implication:** "cross-runtime instruction sync" as a standalone feature is on a path to become a one-line symlink plus a Claude Code shim. The moment Claude Code closes #6235 (plausible within 12 months given 5k+ demand), the multi-file sync problem largely evaporates. Do not anchor the product's moat here.

---

## 2. Claude Code (Anthropic) — most aggressive absorber

- **Plugins + marketplace launched October 9, 2025** (claude.com/blog/claude-code-plugins). A plugin bundles slash commands, subagents, hooks, and MCP servers into one installable, toggleable package. This is a direct overlap with a "catalog/marketplace" feature.
  - https://claude.com/blog/claude-code-plugins
- **Agent Skills** introduced 2025; **December 18, 2025 update added organization-wide skill management, a partner-built skills directory, and published Skills as an open cross-platform standard.**
  - https://claude.com/blog/skills
- **Marketplace scale (reported):** ~101 official plugins by March 2026 (33 Anthropic + 68 partner: GitHub, Playwright, Supabase, Figma, Vercel, Linear, Sentry, Stripe); community marketplaces reporting 2,000+ skills by May 2026.
  - https://www.agensi.io/learn/claude-code-plugin-marketplace-guide
- **Config diagnostics — vendor already ships `/doctor` / `claude doctor`.** It tests the environment, and for settings validation "lists each invalid entry with its source and field"; docs recommend running it on a test machine before fleet deploy. This is a native, first-party version of a config linter/doctor.
  - https://code.claude.com/docs/en/settings , https://computingforgeeks.com/claude-code-cheat-sheet/
  - Community fills the *semantic* gap `claude doctor` doesn't: **claude-config-doctor** (detects semantic conflicts across CLAUDE.md/rules/commands/hooks/settings) and **cclint** (validates agent defs, commands, settings, docs; CI/CD output formats). Signals demand beyond structural validation.
  - https://github.com/tyabu12/claude-config-doctor , https://github.com/carlrannaberg/cclint
- **Enterprise/team config management — Anthropic is building this out fast.** Five config layers incl. an **enterprise "managed settings" policy floor that overrides all lower layers and CLI flags.** **April 2026 admin release added user groups w/ custom roles, per-user spend caps, managed Claude Code policies, and a Compliance API (Enterprise).** Central admin console can push tool permissions, file-access restrictions, and MCP server configs org-wide with no MDM required.
  - https://www.anthropic.com/news/claude-code-on-team-and-enterprise
  - https://www.aicodex.to/articles/claude-admin-controls-2026 , https://www.eesel.ai/blog/admin-controls-claude-code
- **Claude Code web + desktop:** available in terminal, desktop app, and web. Desktop/web behavior is admin-governed (enable/disable web sessions, Remote Control, bypass-permissions) for Team/Enterprise.
  - https://code.claude.com/docs/en/desktop , https://claude.com/product/claude-code/enterprise
- **No official first-party GUI config *editor* found** — config is still files + CLI (`/doctor`, settings.json, managed settings) + the web admin console for policy. That's a real UI gap, but it is per-vendor, not cross-runtime.

---

## 3. Cursor, Windsurf, Zed, Gemini CLI, OpenAI Codex CLI

### Cursor — fastest follower on marketplace + team governance
- **Rules:** modern `.cursor/rules/` directory of `.mdc` files (YAML frontmatter, glob/auto-attach/agent-requested/manual scoping) has superseded legacy `.cursorrules`. Reads AGENTS.md natively.
  - https://baeseokjae.github.io/posts/cursor-rules-advanced-2026/
- **Team Rules:** on Team/Enterprise plans, admins set rules in the Cursor dashboard, **enforced org-wide, individual devs can't disable them.**
  - https://baeseokjae.github.io/posts/cursor-rules-guide-2026/
- **Plugin Marketplace — Cursor 2.5, February 17, 2026:** bundles MCP servers, skills, subagents, hooks, and rules into single installs; browse at cursor.com/marketplace or `/add-plugin`. Launch partners: Amplitude, AWS, Figma, Linear, Stripe, Cloudflare, Vercel, Databricks, Snowflake, Hex. Directly mirrors Claude Code's plugin model.
  - https://www.adwaitx.com/cursor-marketplace-plugins/ , https://cursor.com/docs/mcp/install-links
- **Team Marketplaces — Cursor 3.10, June 30, 2026:** admins configure a Team MCP server once and distribute across cloud agents, agents window, IDE, and CLI. This is vendor-side "standardize agent config across a team" — but Cursor-only.
  - https://mcp.directory/blog/cursor-team-mcp-marketplace-2026
- **One-click MCP install:** supported via install links / mcp.json.

### Windsurf
- Rules hierarchy: Global Rules → `.windsurfrules` / `.windsurf/rules/` directory (glob/NL-scoped) → Memories. `.windsurfrules` is team/git-committed; **Cascade Memories** are personal, auto-generated, per-workspace (`~/.codeium/windsurf/memories/`). Reads AGENTS.md natively.
  - https://docs.windsurf.com/plugins/cascade/memories , https://www.paulmduvall.com/using-windsurf-rules-workflows-and-memories/
- **Workflows** script repeatable agent procedures (test → format). Overlaps a "pipeline builder."

### Zed
- Positioned as the **composable / vendor-neutral IDE host**: via **Agent Client Protocol (ACP)** it runs external agents — Gemini CLI, Claude Code, Codex CLI, OpenCode — installed from an **ACP Registry**. Strong MCP support; memory is assembled via MCP servers rather than a proprietary store. Reads AGENTS.md.
  - https://zed.dev/docs/ai/external-agents , https://www.builder.io/blog/zed-ai-2026
- Note: Zed is itself a partial cross-runtime host — a competitor-adjacent surface to watch, though it's an editor, not a config control center.

### Gemini CLI
- Reads `GEMINI.md` natively; AGENTS.md configurable. MCP + config integration. Runs as an ACP external agent inside Zed.
  - https://codex.danielvaughan.com/2026/05/27/agent-instruction-files-agents-md-claude-md-cross-tool-portability-codex-cli/

### OpenAI Codex CLI
- Reads **AGENTS.md** natively (it originated the spec). `config.toml` schema with **profiles, sandbox modes, MCP integration.** Runs inside VS Code, Cursor, JetBrains, Zed, Neovim.
  - https://blakecrosley.com/guides/codex

---

## 4. MCP ecosystem governance

- **Official MCP Registry launched in preview September 8, 2025** at registry.modelcontextprotocol.io — "an open catalog and API for discovering publicly available MCP servers." Grew to ~2,000 entries within months; **still labeled preview as of June 2026** (schema may shift; namespace/trust model stable).
  - https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/
  - https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026
- **Governance:** working-group maintained, permissively licensed official MCP project; began Feb 2025 as a grassroots effort (PulseMCP, Block/Goose, GitHub, Anthropic, ~9 companies). Supports **public sub-registries and private enterprise registries** with custom security criteria; community moderation (flag/denylist spam, malicious, impersonation).
- **Install UX is converging hard.** GitHub MCP Registry (Sept 16, 2025) surfaces community-registry servers with **one-click install in VS Code/Copilot**; Cursor install links; Cursor 2.5 marketplace; Claude Code plugin MCP bundles. Manual `mcp.json` editing is being abstracted away by every major vendor.
  - https://nordicapis.com/7-mcp-registries-worth-checking-out/

---

## 5. Native config linting / diagnostics

- **Vendors are already here for the structural layer:** Claude Code's `/doctor` / `claude doctor` validates settings and reports invalid entries by source+field; documented as a pre-deploy fleet check. This is a first-party "doctor" and it will only get better.
  - https://code.claude.com/docs/en/settings
- **Community owns the *semantic* layer** (cross-file conflict detection, catalog validation): claude-config-doctor, cclint. No evidence yet of a vendor shipping *cross-file semantic conflict analysis with one-click fixes* — that gap is currently filled only by third-party tools, and only single-runtime (Claude).
- No evidence of Cursor/Windsurf/Codex shipping a public config-lint command comparable to `claude doctor` as of mid-2026 (their validation is largely IDE-inline for rules).

---

## 6. Enterprise / team standardization — is the gap real?

- **Vendors ARE solving "standardize config across a team," but each only within its own runtime:**
  - Cursor Team Rules (dashboard-enforced, non-disableable) + Team Marketplaces (June 30, 2026).
  - Claude Code enterprise managed settings (policy floor) + April 2026 admin console (groups, roles, managed CC policies, Compliance API).
  - Windsurf `.windsurfrules` as team/git-committed conventions.
- **The unmet gap: nobody standardizes config across *different* runtimes for a mixed-tool team.** A team running Claude Code + Cursor + Codex has three separate admin planes, three policy models, three marketplaces. Enterprise AI-governance platforms (Collibra, IBM watsonx.governance, AgentID) operate at the model/agent-runtime-security layer — inventory, permissions, audit — **not at the dev-tool config/instruction/hook layer.** There is no neutral "one config posture across all your agent CLIs/IDEs" product.
  - https://www.getagentid.com/resources/best-ai-governance-tools-for-ai-agents , https://aitoolmind.com/ai-agent-standards-2026/

---

## What vendors will likely absorb within 12 months (DEPRIORITIZE)

1. **Cross-runtime instruction-file sync.** AGENTS.md is now LF-governed, natively read by ~everyone except Claude Code, and the residual Claude gap is a one-line import/symlink already owned by free tools (Agentlink). If Claude Code closes #6235 (5k+ demand), the feature disappears. Do not lead with "sync your CLAUDE.md/GEMINI.md/.cursorrules."
2. **Catalog / marketplace for skills, MCP, plugins.** Claude Code (Oct 2025), Cursor 2.5 (Feb 2026), GitHub MCP Registry (Sept 2025), and the official MCP Registry already own discovery + one-click install. A neutral marketplace will be out-distributed.
3. **Structural config validation / "doctor."** `claude doctor` exists and is enterprise-positioned; other vendors will follow. Structural linting alone is table stakes, not a moat.
4. **Per-runtime one-click MCP install.** Solved and converging across every vendor.
5. **Per-runtime team policy enforcement.** Cursor Team Rules and Claude managed settings already do this inside their own walls.

## What stays structurally vendor-neutral (DOUBLE DOWN)

1. **The cross-runtime plane itself — a single pane over N tools no vendor will unify.** Each vendor is deepening its own walled admin/marketplace/policy plane precisely *because* they won't interoperate. A read/normalize/diff/reconcile layer across Claude Code + Cursor + Windsurf + Codex + Gemini configs is the one thing no single vendor is incentivized to build.
2. **Cross-runtime *semantic* diagnostics with one-click fixes.** Not "is this JSON valid" (vendors do that) but "your Cursor Team Rule contradicts your CLAUDE.md," "this hook is denied by the enterprise managed floor," "your MCP server is registered in Claude but missing in Codex." Vendors validate within one runtime only.
3. **Runtime detection + inventory across a heterogeneous mixed-tool machine/team.** The governance vendors say inventory-first is the winning move, but they inventory *agents/models*, not dev-tool configs. Nobody inventories "what agent tooling + config + hooks + MCP is actually installed across this fleet."
4. **Cross-runtime enterprise standardization / drift detection.** The clearest open gap (§6): one neutral config posture and drift report across every agent CLI/IDE a team uses. This is a governance-adjacent wedge no vendor and no current governance platform occupies.
5. **Local-only / privacy-preserving posture.** Vendor admin planes are cloud/console-based (Cursor dashboard, Claude admin console). A local-first control center is a differentiated trust position for regulated/air-gapped buyers.

## Repositioning implications

- **Reframe from "sync" to "reconcile + govern across runtimes."** Sync is commoditized; the durable job is *drift detection, conflict diagnosis, and policy reconciliation* across tools that will never share an admin plane.
- **Lead with the multi-tool team/enterprise gap, not the solo-dev sync gap.** The enterprise cross-runtime standardization gap (§6) is unoccupied by both tool vendors and governance vendors — that's the defensible wedge and the higher-value buyer.
- **Treat the marketplace/catalog as an aggregator/index over vendor marketplaces, not a competing store.** Compete on unified discovery + "install to the right runtime(s)," not on hosting content.
- **Make semantic, cross-file, cross-runtime analysis the analyzer's headline** — explicitly beyond what `claude doctor`/cclint do (single-runtime, mostly structural).
- **Assume Claude Code closes AGENTS.md within the plan horizon.** Build so the product still wins if instruction-file divergence is gone: the value must live in policy/hooks/MCP/permissions reconciliation and drift, not in `.md` file wrangling.
- **Watch Zed/ACP and vendor plugin bundles** as the surfaces most likely to creep toward "host many agents" — differentiate on being a *config control/governance* plane, not another agent host.
