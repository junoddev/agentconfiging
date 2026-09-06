# Demand Signals: What AI Coding-Agent Users Actually Complain About (2025–2026)

Research for **agentconfiging** — a local-only web UI control center for AI coding-agent config.
Compiled 2026-08-01 from Hacker News, Reddit, GitHub issues/discussions, and practitioner blogs.

> Method note: findings synthesize public discussion. Quotes are paraphrased from cited pages unless in quotation marks; follow the URLs for exact wording. Where a quote is verbatim it is marked "verbatim."

---

## Theme 1 — CLAUDE.md context bloat / "context rot"

The single most-discussed configuration pain. As instruction files and skills grow, agents "start missing instructions, repeating [themselves], or producing outputs that feel slightly off." The community has coined **"context rot"** — degradation from files that grow "too large, dense, or cluttered."

- Recurring advice: "Keep CLAUDE.md short enough to review quickly. **If you cannot skim it between meetings, it is too long.**" (verbatim guidance) — a widely repeated heuristic, signaling that *knowing whether your file is too big* is an unmet need.
- HN threads directly on this: "Compress Your Claude.md: Cut 60-70% of System Prompt Bloat", "Universal Claude.md – cut Claude output tokens", "How big is your claude.md file? I see people complain about this…" — the last title itself shows the topic is a standing community argument.
- Tooling has sprung up purely to shrink startup context: developers report cutting startup context "roughly half" and reducing `/mcp` "from a wall of text to four lines."
- Cost angle: prompt-cache misses on the 1M context window are "expensive"; leaving the machine >1hr busts the cache.

Sources:
- https://news.ycombinator.com/item?id=47144537 (Compress Your Claude.md)
- https://news.ycombinator.com/item?id=47581701 (Universal Claude.md)
- https://news.ycombinator.com/item?id=45688243 ("How big is your claude.md file?")
- https://www.mindstudio.ai/blog/context-rot-claude-code-skills-bloated-files
- https://naqeebali-shamsi.medium.com/stop-wasting-tokens-a-developers-guide-to-claude-code-cleanup-de842f6403e5

## Theme 2 — Instruction-file drift across tools (CLAUDE.md vs AGENTS.md vs .cursor/rules)

The clearest "multi-runtime" pain. Teams using Claude Code + Codex + Cursor + Gemini CLI must maintain per-tool instruction files that "slowly drift as prompts, coding standards, or review expectations change over time." Result: "the same repo behaves differently depending on which agent you use, and a fix in one instruction file does not automatically reach the others."

- Compatibility gotcha users repeatedly hit: **Cursor reads `.cursor/rules/*.mdc` and `AGENTS.md`, not CLAUDE.md; Claude Code reads CLAUDE.md only, not AGENTS.md natively.** This asymmetry drives an entire cottage industry of sync tools.
- An entire class of workaround tools exists solely to solve drift: `agent-sync`, AgentSync (symlink-based), `@mongez/agent-kit` (derives CLAUDE.md / GEMINI.md / copilot-instructions from one AGENTS.md), amtiYo/`agents` ("one .agents source of truth to sync MCP servers, skills, and instructions across Codex, Claude Code, Gemini CLI, Cursor, Copilot, Antigravity").
- A single gist on the "does Claude Code read AGENTS.md" question references the GitHub issue cluster #6235 with "5,200+ reactions" — very high demand signal.
- Recommended patterns are manual and fragile: symlink one canonical file, `@import`, or "add a pre-commit hook and a CI step that fails when any copy diverges from AGENTS.md."

Sources:
- https://minilv.github.io/Plexus/how-to-keep-claude-md-and-agents-md-in-sync.html
- https://github.com/GowayLee/agent-sync
- https://github.com/amtiYo/agents
- https://gist.github.com/yurukusa/d36197848911f025add142abefcde685 (references #6235, 5,200+ reactions)
- https://dev.to/hassanzohdy/one-agentsmd-for-every-coding-agent-auto-derive-claudemd-geminimd-copilot-instructions-2053
- https://codersera.com/blog/agents-md-vs-claude-md-vs-cursor-rules-comparison-2026/

## Theme 3 — MCP server sprawl: token overhead + tool confusion

Two intertwined complaints: (a) MCP tool schemas eat enormous context, (b) too many tools make the agent *dumber*.

- "The GitHub MCP server alone consumes **55,000 tokens across its 93 tool definitions.**" (verbatim figure widely cited)
- "Tasks that worked fine with 10 tools fail with 50." The overloaded agent "misses obvious tool choices. It hallucinates parameters that don't exist. It picks the wrong tool for simple tasks."
- Community remedy that became default behavior: "For any server you haven't actually invoked a tool from in the past two weeks, remove it from your default configuration." Claude Code itself now "defers MCP tool schemas by default and loads them on demand" — vindicating the complaint.
- Proxy/gateway tools ("one-mcp", mcp-proxy-processor, agent-mcp-gateway) exist to cut initial tool cost "from 40,000+ tokens down to ~400."

Sources:
- https://dev.to/thedailyagent/mcp-tool-overload-why-more-tools-make-your-agent-worse-5a49
- https://dev.to/piotr_hajdas/mcp-token-limits-the-hidden-cost-of-tool-overload-2d5
- https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead
- https://news.ycombinator.com/item?id=47193064 (MCP server that reduces context 98%)

## Theme 4 — MCP security fear (untrusted servers, vulnerabilities)

Enterprise-grade anxiety, well-documented by security vendors and picked up in dev discussion.

- "Analysis of 100 Model Context Protocol servers … found that **43% had critical security vulnerabilities**." Prompt injection in 31%, sensitive-data leakage in 28%.
- A 7,000-server scan found "hundreds explicitly bound to all network interfaces," accessible to anyone on the LAN.
- The trust model is the core worry: "you … trust the MCP server author in the same way you trust any code running on your machine." Compromised servers can "exfiltrate file content through tool call responses, inject additional system instructions, or escalate Claude's permissions."

Sources:
- https://www.csoonline.com/article/4181230/claude-code-has-an-mcp-security-problem-and-your-developers-are-already-using-it.html
- https://dev.to/amir_mironi/i-analyzed-100-claude-mcp-servers-and-found-critical-security-flaws-in-43-of-them-ikj
- https://www.ayautomate.com/blog/claude-code-security-risks
- https://www.backslash.security/blog/claude-code-security-best-practices

## Theme 5 — Secrets leaking into config, session logs, and git

Distinct from MCP trust: the config/session files themselves become a secret-exfiltration surface.

- "Any `.env`, `credentials.json`, MCP config with embedded secrets that Claude ever reads leaves a **permanent copy in the local session store**" (`~/.claude/projects/*.jsonl`). Two live Anthropic API keys were found embedded in session JSONL.
- Registry scan: "Across ~46,500 packages, 428 packages contained a `.claude/settings.local.json` file, with 33 files across 30 packages containing live credentials." (i.e., people commit their agent config with secrets in it)
- Classic failure: "One `git add .` and your API keys are on GitHub." Claude proposing commits that include modified `.env`/secrets is a repeated horror story.
- Workarounds: macOS Keychain for MCP secrets, secret-scanning commit hooks — again, manual and per-user.

Sources:
- https://github.com/frederick-douglas-pearce/agentfluent/issues/72 (prevent .env leakage into transcripts)
- https://www.token.security/blog/how-to-stop-exposing-secrets-on-your-mcp-configs
- https://bdtechtalks.com/2026/04/27/claude-code-api-token-leak/
- https://kahunam.com/articles/automations-ai/securing-mcp-server-secrets-with-macos-keychain/
- https://cyata.ai/blog/whispering-secrets-loudly-inside-mcps-quiet-crisis-of-credential-exposure/

## Theme 6 — Team sharing / no single source of truth / onboarding friction

High-demand, currently unmet by the official tooling.

- Feature Request #30554 (anthropics/claude-code) — "Team/shared CLAUDE.md configuration support" — names it exactly: "**Company-wide standards drift** — each person ends up with a different version; **Onboarding friction** — new collaborators have to manually copy/configure settings; **No single source of truth** for how Claude should behave across the team." Users ask for a remote config URL, repo-level `.claude/TEAM.md`, and `@import`/`@include`. (Closed as duplicate — i.e., recurring.)
- "Existing workarounds like shared git repos with symlink setup scripts are fragile and require every team member to manually run setup."
- Payoff quantified in the wild: shared `claude.json` "cuts team onboarding from two hours to under 15 minutes"; teams sharing CLAUDE.md/Skills/MCP/subagents "onboard new hires in 30 minutes, not three days."
- Anthropic partially responded with a `/team-onboarding` slash command — confirms the pain is real but leaves config *distribution* unsolved.

Sources:
- https://github.com/anthropics/claude-code/issues/30554 (Feature Request: Team/shared CLAUDE.md config)
- https://duet.so/guides/claude-code-for-teams
- https://nimbalyst.com/blog/how-to-set-up-claude-code-for-your-team/
- https://ao92265.github.io/claude-code-playbook/docs/news/team-onboarding/

## Theme 7 — Multi-repo / layered config complexity

- Users build elaborate manual structures: `WORKSPACE.md` registries, org/team/repo layered CLAUDE.md, temporary `CONTEXT.md` files ("the extra 2 minutes writing CONTEXT.md saves 20 minutes of re-explaining").
- Feature Request #44656 asks for "Isolated multi-repo environments for Claude Code" — evidence that layering is done by hand today.

Sources:
- https://karun.me/blog/2026/03/26/structuring-claude-code-for-multi-repo-workspaces/
- https://www.iamraghuveer.com/posts/multi-repo-workspace-claude-code/
- https://github.com/anthropics/claude-code/issues/44656
- https://blog.marcolancini.it/2026/blog-my-claude-code-setup/

## Theme 8 — "My instructions are read but not followed" (enforcement gap)

A trust crisis around whether config even works.

- Multiple high-traffic GitHub issues: #19471 "CLAUDE.md instructions completely ignored after context compaction," #27032 "Model ignores CLAUDE.md instructions despite reading them," #18660 "[FEATURE] … read but not reliably followed — need enforcement mechanism," #28158, #7777.
- Users note CLAUDE.md gets wrapped in framing that says it "may or may not be relevant" and to follow it "if highly relevant" — then "CLAUDE.md values get summarized away" on compaction. "Unable to trust CLAUDE.md for anything important."
- Emerging fix: **SessionStart hooks** that re-inject standards on startup/resume/clear/compact — i.e., a config-management pattern users assemble by hand.

Sources:
- https://github.com/anthropics/claude-code/issues/19471
- https://github.com/anthropics/claude-code/issues/18660
- https://github.com/anthropics/claude-code/issues/27032
- https://dev.to/albert_nahas_cdc8469a6ae8/your-claudemd-instructions-are-being-ignored-heres-why-and-how-to-fix-it-23p6

## Theme 9 — Token/cost tracking and usage anxiety

Very high-volume complaint, though adjacent to config.

- Extreme anecdotes drive engagement: "$50,000 worth of Claude Code tokens in 30 days on a $200 plan"; "my Max plan evaporated in 70 minutes"; single prompts eating "30–90% of a 5-hour budget."
- **ccusage** (4,800+ GitHub stars) is "the tool most developers reach for" — reads local JSONL, fully offline, no API key. Strong proof of appetite for local, privacy-preserving analytics that read the same JSONL agentconfiging can read.

Sources:
- https://github.com/phuryn/claude-usage
- https://www.toriihq.com/articles/five-claude-code-usage-dashboards-and-monitoring-tools
- https://dev.to/markliuyuxiang/i-consumed-50k-worth-of-claude-code-tokens-on-a-200-plan-should-i-be-blamed-4176

## Theme 10 — Session history search / replay

- Crowded workaround field proves demand: Claude Code History Viewer (1.9K stars, reads 8 other tools' logs too), Claude-Replay (SQLite + MCP + HTML export), Mantra (visual diffs, step navigation), plus a "Session History & Analytics" skill.
- Repeated user desire: "You can finally search every Claude session" — retrieval of past work is a felt gap.

Sources:
- https://github.com/jhlee0409/claude-code-history-viewer
- https://github.com/constripacity/Claude-Replay
- https://dev.to/gonewx/i-tested-4-tools-for-browsing-claude-code-session-history-17ie

---

## Solved pains → copy angles (with user language)

These map to agentconfiging's existing features. Use the users' own words in marketing.

1. **Secret redaction / config parsing (Themes 4–5).** Angle: *"Your `.env` and MCP secrets leave a permanent copy in `~/.claude` session logs. See — and redact — every secret in your agent config before it leaks."* User language to echo: "one `git add .` and your API keys are on GitHub," "secrets quietly accumulate outside the view of established security workflows." agentconfiging's redaction + config viewer directly answers this.
2. **MCP server inventory + analyzers (Themes 3–4).** Angle: *"See every MCP server, what it costs you in tokens, and whether it's safe — in one panel."* Echo: "for any server you haven't invoked in two weeks, remove it," "43% had critical security vulnerabilities," "the GitHub MCP server alone eats 55,000 tokens." The 13 analyzers with one-click fixes are the payoff.
3. **Cross-runtime instruction sync (Theme 2).** Angle: *"Stop the drift. One source of truth, projected into CLAUDE.md, AGENTS.md, and .cursor/rules — no fragile symlink scripts, no CI diff-guards."* Echo verbatim pain: "the same repo behaves differently depending on which agent you use," "a fix in one file doesn't reach the others." This is the strongest differentiated pillar — a #6235 cluster with 5,200+ reactions.
4. **Runtime detection + write-back editors + config parsing (Themes 1, 7).** Angle: *"See all your CLAUDE.md / AGENTS.md / rules across every repo and runtime, and edit them in one place."* Echo: "if you cannot skim it between meetings, it is too long."
5. **Session analytics / replay / search (Theme 10).** Angle: *"Search and replay every session — locally, no account."* ccusage/History-Viewer adoption proves the market; agentconfiging bundles it with config management.
6. **CI JSON report command (Themes 2, 5, 8).** Angle: *"Fail CI when config drifts or a secret sneaks in."* Directly replaces the hand-rolled "pre-commit hook + CI step that fails when copies diverge."
7. **Local-only / privacy (all themes).** Angle: *"Runs entirely on your machine — like ccusage, no API key, no network call."* This matches the exact reason the most-adopted tools won (see below).

## Unsolved pains → feature-gap candidates, ranked by frequency of complaint

1. **Token/cost tracking & budgets (Theme 9) — highest volume.** ccusage's 4,800 stars and the viral "$50k on a $200 plan" genre show massive appetite. agentconfiging already reads session JSONL for analytics; adding cost/budget tiles is a small step to a widely-requested capability. **Top recommended gap to close.**
2. **CLAUDE.md quality scoring / bloat detection & compression (Theme 1).** No first-class "is my instruction file too big / redundant?" scorer exists; users eyeball it and run ad-hoc "compress my CLAUDE.md" tools. A quality/size analyzer with suggested trims fits the analyzer framework perfectly and is highly differentiated.
3. **Team/git-based config distribution (Theme 6).** Feature Request #30554 asks precisely for shared config with a single source of truth. agentconfiging syncs *instructions across runtimes on one machine* but (per brief) not *config distribution across a team*. Candidate: export/import bundles, "publish to repo," remote/shared config profiles.
4. **Instruction enforcement / SessionStart-hook management (Theme 8).** Users want config that actually sticks after compaction. A guided hook builder ("re-inject standards on compact") would monetize a real, repeated frustration. (agentconfiging has a pipeline/cron builder — adjacent, but not this specifically.)
5. **Backup / versioning of global config (Themes 5–6).** Implied by drift + accidental-commit stories; no dominant tool. "Snapshot & roll back your `~/.claude`" is a natural adjacency to write-back editing.
6. **Profile switching / per-project presets (Theme, profiles).** People hack this with `CLAUDE_CONFIG_DIR` aliases and tools like `ccc`/`ccs`. A GUI profile switcher is a modest, well-precedented add.
7. **Team usage analytics (Theme 9, enterprise slice).** Beyond personal cost — org rollups. Larger scope; lower priority for a local-only tool.

## Adoption pattern lessons

- **Local-first, zero-setup, reads existing JSONL wins.** ccusage's explicit selling points — "runs locally, no external dependencies, no API key, no network call, no account setup" — are *why* it became the default (4,800+ stars). agentconfiging's local-only architecture is on-strategy; lead with it.
- **Solve a pain the official tool half-solves.** SuperClaude (22,100 stars), Superpowers (~94k), GSD (~35k), gstack (~50k) all exploded by making Claude Code "consistently good instead of sometimes good." Config-management is the same shape: Anthropic shipped `/team-onboarding` and on-demand MCP schema deferral, acknowledging the pains but not fully solving distribution, drift, or quality. Position agentconfiging as the layer that finishes the job.
- **Drift tools multiply because the manual fix is fragile.** The sheer number of sync tools (agent-sync, agent-kit, amtiYo/agents, symlink scripts) plus the 5,200-reaction issue cluster show users will adopt *anything* that reliably kills drift — but current options are CLIs/symlinks that "require every team member to manually run setup." A GUI that just shows and reconciles all files removes the fragility they complain about.
- **Security framing has enterprise pull.** Vendor research (43% vulnerable, 7,000-server scans, registry secret leaks) means "see and redact secrets in your agent config" and "audit your MCP servers" resonate with security-conscious buyers, not just hobbyists — a path to team/paid tiers.
- **Bundling beats point tools.** Users currently stitch together ccusage + a history viewer + a sync CLI + secret-scan hooks. A single local control center that covers config + secrets + MCP + sync + analytics is the consolidation play; every point tool's star count is a pre-validated demand estimate for that surface.
