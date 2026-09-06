# Market research synthesis — feature gaps & repositioning

**Date:** 2026-08-01 · **Inputs:** four parallel research teams (see
`research/competitors-direct.md`, `research/adjacent-tools.md`,
`research/vendor-trends.md`, `research/demand-signals.md`). This file is the
decision-grade summary; the four source files carry the citations and detail.

---

## 1. The one thing to internalize

**Our differentiator is not any single feature — it is the closed loop across
runtimes.** Three of four teams converged on this independently:

> **detect → inspect → analyze → fix → edit → sync → verify**, run locally, with
> no telemetry, across every runtime — versus stitching five point-CLIs together.

Every feature we bundle already has a stronger single-purpose incumbent. We do
not win any one column. We win the *row* — the integrated loop and the
cross-runtime plane no vendor is incentivized to build. Positioning and roadmap
should both serve that thesis.

---

## 2. Repositioning: what to lead with, what to demote

| Capability | Old framing | Research verdict | New framing |
|---|---|---|---|
| **Cross-runtime instruction sync** | Lead pillar ("sync your CLAUDE.md everywhere") | **Acute user pain TODAY (5,200+ reactions) but a shrinking moat** — AGENTS.md went to the Linux Foundation (Dec 2025), read natively by ~every runtime but Claude Code, whose gap is a one-line import. | Keep as a **launch** hook (pain is real now), but reframe verb **"sync" → "reconcile + govern across runtimes"** — the drift *detection/diff* survives even after sync commoditizes. |
| **Analyzers / config lint** | "Lint for your agent config" | **Strongest MEET-and-differentiate** — nobody owns hygiene + one-click autofix + write-back. BUT `claude doctor` made single-runtime structural lint table stakes, and AgentLinter/Codacy made a **0–100 score + content-quality checks** (token efficiency, buried-rule "position risk", cross-file contradictions) table stakes. | Headline the **semantic, cross-file, cross-runtime** diagnostics (beyond any single-vendor doctor). **Add a headline score + content-quality checks** — currently a gap. |
| **Secret redaction** | Named as a trust feature | **No longer a differentiator** — Claudoscope, AgentLinter, Codacy all ship it; and it is **NOT "secret scanning"** (TruffleHog verifies live creds w/ 800+ detectors — that framing is an instant loss). | Keep as a safety *property* of the local architecture; never market it as secret scanning or as a headline. |
| **Catalog / marketplace** | A core surface | **Already vendor-owned** — Claude Code plugins, Cursor 2.5 marketplace, official MCP Registry (Sep 2025), Smithery ~7,000 servers. A hand-curated catalog looks parochial. | Reframe as an **aggregator/index** that *consumes* those registries; differentiate on lint/redaction/provenance over installs. |
| **Session analytics/replay** | A core surface | **Crowded**; ccusage (4,800★) owns cost numbers. | Don't out-compute ccusage. Differentiate on the **closed loop** (analytics feeding lint→fix) that read-only observers structurally can't do. **Add cost tiles — see gap #1.** |
| **Git panel + terminal** | Operate surface | Parallel-worktree **multi-session** (Crystal→Nimbalyst, opcode) is the beloved feature here and **we don't do it**. | Position as **complementary**, not a GUI/session-manager competitor. Don't pick this fight. |
| **Visual pipeline builder + cron** | One feature among many | **Genuine white space** — orchestration is almost all YAML/CLI; no dominant *visual* incumbent. | **Promote** — but scope honestly as "visual hooks + scheduled local jobs," NOT "multi-agent orchestration" (invites Agent Teams/Ruflo comparison). |
| **Full visual GUI over the whole loop** | Implicit | **The genuine white space nobody else has** (competitors team). | **This + the pipeline builder are the safest things to feature.** |

**Net positioning line:** *"One local, no-telemetry control center for the whole
detect→analyze→fix→sync loop, across every agent runtime — instead of stitching
five CLIs together."* Privacy/local-only is the wedge against SaaS-leaning
entrants (Codacy) and cloud admin consoles.

---

## 3. Feature gaps — ranked by evidence

### Tier 1 — build before or shortly after launch (high leverage, low lift)

1. **Token/cost tracking + budgets.** *Highest-volume complaint in the entire
   market* (the viral "$50k on a $200 plan" genre). ccusage (4,800★) proves the
   appetite and the winning pattern. **We already parse the same session JSONL**
   → cost tiles are the single highest-leverage addition. *(demand-signals)*
2. **CLAUDE.md quality / bloat score (0–100).** Two teams: it answers the
   "context rot" pain ("if you can't skim it between meetings, it's too long")
   *and* it's now competitive table stakes (AgentLinter/Codacy ship a score +
   position-risk/contradiction checks). Fits the existing analyzer framework. A
   differentiated headline number. *(demand-signals, competitors)*

### Tier 2 — strong, larger lift or post-launch

3. **Team / git-based config distribution.** Named by three teams; Feature
   Request #30554 asks for it verbatim. This is also the **structurally safest
   long-term ground**: enterprise standardization + drift detection for
   mixed-tool teams is the clearest *unoccupied* gap (governance vendors track
   models, not dev-tool configs; tool vendors govern only inside their walls).
4. **Runtime breadth for sync.** rulesync (~1.3k★) and Ruler (~2.8k★) fan out to
   30–40+ runtimes and cover MCP/commands/subagents/hooks; our sync target list
   is narrower. Close the gap to blunt "X already syncs more." *(competitors)*
5. **Packaged GitHub Action wrapping `report`.** Small lift; meets teams where
   they gate (SARIF/JSON), turns the CI story from "possible" to "one line."
6. **Nested/monorepo rule loading.** Ruler has it; common real-world layout.

### Explicitly DON'T chase
- Parallel multi-session/worktree management (Crystal/opcode own it).
- Out-computing ccusage on cost math (reference it instead).
- "Secret scanning" (TruffleHog's game — we lose the framing instantly).
- A competing curated marketplace/store (federate instead).

---

## 4. Competitive landscape at a glance

| Tool | Scope | Traction | Their edge over us | Our edge over them |
|---|---|---|---|---|
| **rulesync** | Sync CLI | ~1.3k★, dominant npm | 30–40+ runtimes, fans out MCP/hooks | GUI, analyzers, fixes, the loop |
| **Ruler** | Sync CLI | ~2.8k★ | Runtime breadth, nested/monorepo | GUI, safety (diff/provenance), loop |
| **claude-code-templates** | Catalog+analytics+plugin UI | ~30k★, aitmpl.com | Marketplace scale, mindshare | Cross-runtime, visual write-back, diff-previewed fixes |
| **AgentLinter / Codacy** | Config linting | — (Codacy = SaaS) | 0–100 score, content-quality checks | Local-only, cross-runtime, one-click fix + write-back |
| **ccusage** | Cost analytics | 4,800★ | Trusted cost numbers | Closed loop (we act on the data) |
| **Crystal→Nimbalyst / opcode** | Session GUI | popular | Parallel multi-session | Config depth; different job |

Field is **fragmented into point tools** — which *is* the opening. Nobody else
runs the whole loop locally across runtimes.

---

## 5. Impact on the launch plan

The launch plan's current pillars (local-only + "lint for your config" +
sync-as-hook) need three adjustments:

1. **Lead with the loop**, not lint-in-isolation. "The control center that
   closes the loop" beats "lint for your config" (which now collides with
   `claude doctor` + Codacy).
2. **Keep sync as a launch hook but reframe the verb** to reconcile/govern; be
   ready for "AGENTS.md already standardizes this" in the HN thread (answer:
   standardization ≠ reconciliation/diagnostics, and Claude Code still doesn't
   read it).
3. **Ship at least the cost tiles** (Tier-1 #1) before launch if at all
   possible — it converts our biggest structural gap into an on-ramp from the
   most-searched pain, and we already have the data.

**Recommended pre-launch scope call:** Tier-1 #1 (cost tiles) and #2 (bloat
score) are both low-lift on existing infrastructure and each neutralizes a
table-stakes gap while feeding the loop narrative. Suggest both as
launch-blocking if timeline allows; #1 at minimum.
