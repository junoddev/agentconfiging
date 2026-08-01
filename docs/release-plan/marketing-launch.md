# Marketing & Launch Plan — `agentconfiging`

Status: draft v1 · Owner: maintainer · Scope: first public launch of the OSS package

This plan works backward from a single coordinated launch day ("L-day"). It
assumes no budget, one primary maintainer, and an audience that lives on
Hacker News, X, Reddit, and Discord.

---

## 1. Positioning

### Positioning statement

> **`agentconfiging` is the local control center for AI agent configuration.**
> Run `npx agentconfiging` in any repo and it opens a localhost web UI over the
> agent setup you're already sitting in: it detects your runtimes (Claude Code,
> Cursor, Copilot, Codex, Gemini CLI, and more), parses every config artifact,
> flags problems with 13 analyzers, and lets you fix, edit, sync, and operate —
> with every write shown as a diff before it lands. There is no account, no
> hosted component, and no telemetry; nothing ever leaves your machine. For
> developers drowning in `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, hooks, MCP
> servers, and settings files scattered across tools, it replaces greping
> dotfiles and copy-pasting instruction files with one inspectable, reversible
> surface.

### One-liners (pick per channel)

- Shortest: **"A local control center for your AI agent config. `npx agentconfiging`. Nothing leaves your machine."**
- HN-flavored: **"Show HN: I got tired of hand-editing CLAUDE.md, .cursorrules, and MCP configs across five tools, so I built a localhost UI that inspects, lints, and syncs all of them."**
- Feature-flavored: **"Detects 8 agent runtimes, lints your config with 13 analyzers, one-click fixes with diff preview, and syncs instruction files across 15 formats."**

### Target segments (in priority order)

1. **Claude Code power users.** Heavily invested in `CLAUDE.md`, hooks, skills,
   subagents, MCP servers, `settings.json`, and session history. They feel the
   pain daily and are concentrated in reachable places (r/ClaudeAI, X, Discord).
   The session analytics/replay and Claude Code plugin marketplace features are
   built almost entirely for them. **This is the beachhead.**
2. **Multi-tool developers.** People running two-plus of Claude Code / Cursor /
   Copilot / Codex / Aider / Gemini CLI and manually keeping instruction files
   in agreement. Instruction sync (source-of-truth → regenerate the rest,
   15 target formats) is the single sharpest hook for this group.
3. **Teams standardizing agent config / platform & DX engineers.** They care
   about `agentconfiging report` in CI (exit codes gate builds, no file
   contents in output), the findings analyzers as a "lint for agent config,"
   and provenance-stamped installs from the catalog. Smaller audience, longer
   sales cycle, but the stickiest usage — target with follow-up content, not
   launch-day messaging.
4. **Secondary/later:** agent-tooling authors (catalog/marketplace listing is a
   distribution channel for them) and automation tinkerers (pipelines + cron
   daemon). Do not lead with pipelines at launch; it dilutes the story.

### Competitive / adjacent landscape — what people do today

| Today's behavior | Our answer |
|---|---|
| Hand-edit dotfiles: `CLAUDE.md`, `.cursorrules`, `settings.json`, `.mcp.json` in a text editor; grep to find problems | Structured inspector + 13 analyzers + visual editors with diff-previewed write-back |
| Copy-paste / symlink `CLAUDE.md` → `AGENTS.md` → `.cursorrules`, or a bespoke shell script | Instruction sync with a designated source of truth, drift findings, one-click resolve |
| Single-purpose OSS tools: usage/analytics dashboards for Claude Code (ccusage-style), session viewers, GUI wrappers (Claudia/opcode-style), rules-sync utilities (Ruler-style), template collections and "awesome-claude-code" lists | One integrated surface; the analytics, catalog, and sync are features, not the whole product |
| The `AGENTS.md` convention as a lowest-common-denominator standard | We embrace it (it's a supported source of truth), and cover everything the convention doesn't: settings, hooks, MCP, skills, sessions |
| Claude Code plugin marketplaces / `npx` template installers | Our catalog is checksum-verified, diff-previewed, provenance-stamped — installs stay traceable and removable |
| Nothing (config rot goes unnoticed until an agent misbehaves) | `report` in CI catches broken imports, missing hook scripts, MCP commands not on PATH, committed `settings.local.json`, etc. |

**Category framing:** avoid "dashboard" (passive) and "IDE" (overclaims). Use
**"control center"** consistently — it implies inspect + act, matches the
README, and is not owned by any competitor in this space.

---

## 2. Core narrative & message pillars

### Narrative

Agent configuration became a real surface area in the last two years — every
tool invented its own files, formats, hooks, and marketplaces — but the tooling
for *managing* that surface is still `vim` and folklore. `agentconfiging` treats
your agent setup as a first-class system: inspectable, lintable, editable with
diffs, syncable across tools, and operable — all from a single `npx` command
that runs entirely on your machine.

### Pillars (3–5, ordered)

1. **Zero-friction, local-only, nothing uploaded.** `npx agentconfiging` is the
   whole install story: localhost on `127.0.0.1`, per-session bearer token,
   strict Origin checks, no account, no telemetry, secrets redacted server-side
   before they reach the browser, deletes go to trash. This is the trust
   foundation for everything else and must be in the first paragraph of every
   launch asset — a tool that reads your `settings.json` and MCP configs (which
   contain API keys) *must* answer "where does my data go?" before being asked.
   The honest, adversarial-data security model in the README is itself a
   marketable artifact; HN in particular rewards this posture.
2. **It finds real problems — and fixes them.** 13 analyzers with concrete,
   relatable findings: broken `@import`, missing hook scripts, MCP command not
   on PATH, committed `settings.local.json`, stale model refs, conflicting
   instructions. Machine-applicable fixes get a one-click APPLY, and *every*
   write is a previewed unified diff. "Lint for your agent config" is the
   fastest way to explain value in one sentence.
3. **One source of truth across every tool.** Designate a source instruction
   file; regenerate the rest (Claude Code, Cursor, Gemini, plus the long tail:
   Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo). This is the pillar with
   the broadest resonance beyond the Claude ecosystem and the best demo-GIF
   material.
4. **See what your agents actually did.** Session dashboard, redacted replay,
   full-text search, context-health budgets. Emotionally compelling ("relive
   the session where it went sideways") and unique among config tools.
5. **From inspection to operation.** Git panel, embedded terminal that launches
   any detected runtime, visual pipeline builder with cron scheduling, `report`
   for CI. Frame as "and it grows with you" — the depth pillar, not the lead.

**Anti-messaging (things to explicitly not say):** not an agent framework, not
a wrapper that runs your agents for you, not a hosted platform, not telemetry-
funded, and no AI features that phone home. Reviewers will probe for all five.

---

## 3. Launch sequence

### Strategy: soft launch first, then one coordinated day

A two-stage launch de-risks the big day: the soft launch surfaces crashes,
platform bugs (Windows paths, Node versions, the optional native modules), and
messaging that doesn't land — while the audience is small and friendly. Do
**not** post to HN during the soft launch; HN's duplicate detector and the
"already saw this" effect will blunt the coordinated launch.

**Stage 1 — Soft launch (L-14 → L-7):**
- Publish to npm (it may already be public; "soft launch" means *telling people*).
- Post in 2–3 Discord communities (Anthropic/Claude Code community server,
  one or two AI-coding servers you already participate in) framed as "I built
  this, would love brutal feedback."
- One low-key X thread from the maintainer account, no growth-hacking.
- Ask 5–10 developer friends to run it cold on their real repos and report the
  first confusing moment. Fix the top three.
- Goal: 20–50 real runs, zero crash-on-launch reports, README validated.

**Stage 2 — Coordinated launch (L-day, Tuesday or Wednesday):**
All channels within ~6 hours, sequenced below.

### Channel-by-channel assessment & order

| Order | Channel | Verdict | Notes |
|---|---|---|---|
| 1 | **Hacker News — Show HN** | **The main event.** | This product is close to an archetypal Show HN: dev tool, `npx` one-liner, local-only, honest security model, MIT. Post ~8–9am ET Tue/Wed. Title formula: `Show HN: Agentconfiging – local control center for AI agent config (npx, no account)`. First comment from the maintainer: why you built it, the security model, what's rough. Expect and welcome security scrutiny (see Risks §8). Do not ask anyone to upvote; do share the direct link privately only as "I posted this" (voting-ring detection is real). |
| 2 | **X/Twitter** | **Yes, same morning.** | Thread: hook line + 15–30s screen capture, then one tweet per pillar with a GIF each (findings/APPLY, instruction sync, session replay). Tag nothing corporate; reply to every response for 48h. Quote-tweet the HN post once it has traction, not before. |
| 3 | **Reddit** | **Yes — r/ClaudeAI first.** | r/ClaudeAI is the beachhead segment's home and receives tool posts well when they're substantive. Write a native post (what it does, screenshots, honest limitations), not a link-drop. Stagger: r/ClaudeAI on L-day; r/cursor and r/ChatGPTCoding L+1; r/programming only if the HN post did well (it's link-only, so submit the blog post). Never cross-post identical text; each sub gets its own framing. |
| 4 | **Discord communities** | **Yes, ongoing.** | Already warmed in the soft launch. On L-day, share the launch post in showcase/share-your-project channels only. Discord is more valuable post-launch as a support/feedback loop than as a launch amplifier. |
| 5 | **Dev newsletters** | **Yes, L+1 → L+14 (pitch at L-7).** | Pitch: TLDR (Dev/AI), JavaScript Weekly / Node Weekly (it's an npm CLI), Console.dev (they actively seek OSS dev tools), Bytes, ai-focused newsletters. A strong HN showing is itself the pitch — many of these scrape HN, so email them *the day after* with the HN link and a 2-sentence description. Low effort, real tail. |
| 6 | **Product Hunt** | **Skip at launch; optional at v1.0.** | Wrong audience-effort ratio for a CLI-first OSS tool with no hosted signup. PH traffic converts poorly to `npx` runs, and a mediocre PH day is mildly negative signal. Revisit if/when there's a bigger release and a hunter who cares. |
| 7 | **YouTube/streamers** | **Post-launch only.** | Offer the demo repo + talking points to 2–3 AI-coding YouTubers at L+7. Zero cost, occasionally a large spike. |

**One launch owner rule:** on L-day one person owns posting and replying;
context-switching across five comment sections is the whole job for 48 hours.

---

## 4. Content plan

### 4.1 Launch blog post (the anchor asset)

- **Angle:** *"Your agent config is a system. Treat it like one."* Open with
  the fragmentation pain (five tools, nine file formats, zero linting), walk
  the narrative arc: inspect → lint → fix → sync → operate. Include the
  security model as a full section, not a footnote — it doubles as the answer
  to the top HN objection.
- **Format:** publish on a blog you control (GitHub Pages or the project site);
  this is what gets submitted to r/programming and linked from newsletters.
  1,200–1,800 words, heavy on screenshots and one embedded GIF.
- **Secondary post (L+7):** a technical deep-dive that HN loves as a follow-up,
  e.g. "Designing a localhost tool that's safe to give filesystem write access
  and a PTY" — the token/Origin/canonical-path-guard/trash-not-unlink story.

### 4.2 Demo video & GIFs (launch-blocking)

- **Hero capture (45–60s, no voiceover needed, captions burned in):**
  1. `npx agentconfiging` in a real repo → browser opens (5s)
  2. Overview: detected runtimes with confidence meters (5s)
  3. Findings list → click APPLY → unified diff → commit (15s) ← the money shot
  4. Instruction sync: edit source of truth → regenerate `.cursorrules` +
     `GEMINI.md` with diff preview (15s)
  5. Session replay or the live watcher updating the UI on file save (10s)
- **Three standalone GIFs** (<10MB each, for README, X, Reddit): APPLY-fix,
  instruction sync, live-update. The Console design language is genuinely
  distinctive — dark, data-dense, one green accent — lean on it; the tool
  should be recognizable from a thumbnail.
- **Demo repo:** a small public repo pre-seeded with interesting config *and
  deliberate problems* (broken `@import`, missing hook script, drifted
  instruction files) so anyone can reproduce the demo in 30 seconds:
  `npx agentconfiging` after cloning. Link it from the README and every post.

### 4.3 Social posts

- X launch thread (drafted and reviewed by L-2; 6–8 tweets mapped to pillars).
- 3–4 follow-up singles for the week after: one analyzer spotlight ("it caught
  a committed settings.local.json"), one sync spotlight, one `report`-in-CI
  snippet, one user-reaction retweet.
- Reddit posts drafted per-subreddit by L-2 (different text each).

### 4.4 README polish (launch-blocking items flagged)

- **[BLOCKER] Screenshots.** The README says "Screenshots: TODO." A Show HN
  where the first click is an imageless README underperforms badly. Land the
  hero GIF at the top of the README plus 3–4 stills in `docs/images/`.
- **[BLOCKER] Design-language naming consistency.** **DECIDED (2026-08-01):
  Console is the public name; "Signal Grid" is deprecated.** Remaining work:
  align README, SPEC.md, and all launch copy to Console (README's Signal Grid
  paragraph needs a rewrite, not a find-replace). Reviewers diff docs.
- Add badges (npm version, CI, license), a 10-second "why" above the fold, and
  a FAQ section pre-answering: Windows support status, what happens without
  the optional native modules, "does anything leave my machine" (no), and
  "how do I turn parts of it off."
- Verify `npx agentconfiging` cold-start works on macOS/Linux/Windows and on
  Node 20/22 from a clean cache — the README's first line is a promise.

---

## 5. Community readiness

All of the following by L-7:

- **Issue templates** (`.github/ISSUE_TEMPLATE/`): bug report (asks for OS,
  Node version, runtime(s) detected, whether the optional native modules are
  installed, and the sanitized log from `~/.local/state/agentconfiging/logs/`),
  feature request, and a **runtime/format detection request** template — the
  latter will be the most common ask ("support tool X") and templating it turns
  noise into a roadmap.
- **GitHub Discussions** enabled with categories: Q&A, Show & Tell (people's
  configs/pipelines), Ideas, Announcements. Route "how do I" from issues to
  Discussions to keep the issue tracker triage-able.
- **CONTRIBUTING.md**: dev setup (`npm run dev`), test commands, the
  clean-room/original-code policy from the README, pointer to
  `docs/ARCHITECTURE.md`, and a short "good first issue" pointer. Label 5–8
  genuine good-first-issues before L-day — HN readers do click them.
- **SECURITY.md** with a private disclosure channel (GitHub private
  vulnerability reporting). Given the product's security posture is a message
  pillar, *not* having this is a credibility hole.
- **Code of Conduct** (Contributor Covenant, five minutes).
- **Launch-day staffing:** maintainer clears calendar for L-day and L+1.
  Commit to a response SLO: every HN comment within 1–2 hours for the first
  12 hours; every GitHub issue acknowledged within 24 hours for the first week.
  Prepare a short canned-answers doc beforehand: security model, Windows,
  "why not just AGENTS.md," "how is this different from <analytics tool>,"
  name pronunciation, roadmap, license/clean-room. Fast, non-defensive answers
  in the HN thread are worth more than any prepared copy.

---

## 6. Success metrics & measurement

Realistic OSS targets — the goal of launch week is *qualified attention plus
retention signal*, not vanity spikes.

| Metric | Source | Week 1 (good) | Day 30 (good) | Notes |
|---|---|---|---|---|
| GitHub stars | GitHub | 300–800 (strong HN: 1k+) | steady drip continuing | Momentum indicator only |
| npm downloads | npmjs / npm-stat | 1,000–3,000 | 150+/week floor after decay | `npx` runs count as downloads; watch the **post-spike weekly floor** — that's real usage |
| HN result | HN | front page ≥ 3h, 100+ points | — | Comment quality > points |
| Retention proxy: returning issues/discussions from non-launch-day users | GitHub | — | 10+ substantive threads | Best available signal without telemetry |
| External mentions | newsletter placements, blog/video mentions | 1–2 | 3–5 | Each has a long tail |
| Contributors | GitHub | 1–2 first-time PRs | 3–5 | Detection/sync-target PRs are the likeliest |

**Measurement approach — keep it manual and honest:** there is deliberately no
telemetry (it's a message pillar; never compromise it). A 15-minute weekly
ritual: record stars, weekly npm downloads, open/closed issues, and notable
mentions in a `docs/release-plan/metrics.md` table. GitHub traffic insights
(referrers, clones) for two weeks post-launch. Define launch success as: **the
day-30 npm weekly floor is meaningfully above zero and strangers are filing
substantive issues.** If both hold, the retention story is real.

---

## 7. Timeline (working backward from L-day)

Suggest L-day ≈ 4 weeks out — a Tuesday or Wednesday, avoiding US holiday
weeks and, if possible, major AI-vendor event days (they eat the news cycle).

| When | Work | Blocking? |
|---|---|---|
| **L-28 → L-21** | Decide the name question (§8, decision gate). Freeze launch feature scope — no new features after this, bugs only. Cold-start QA matrix: macOS/Linux/Windows × Node 20/22, with and without optional native modules. | Name decision **blocks everything downstream** (package, README, posts) |
| **L-21 → L-14** | README overhaul incl. screenshots + hero GIF; fix Signal Grid/Console naming; build the seeded demo repo; write the launch blog post draft. | Screenshots/GIF: **BLOCKER**. Naming consistency: **BLOCKER** |
| **L-14 → L-7** | **Soft launch** (Discords, quiet X post, 5–10 cold testers). Fix top-3 friction items. Community scaffolding: issue templates, Discussions, CONTRIBUTING, SECURITY.md, CoC, good-first-issues. Pitch newsletters (embargo-style heads-up). | SECURITY.md: **BLOCKER** (security is a pillar). Crash-on-launch bugs from soft launch: **BLOCKER** |
| **L-7 → L-2** | Finalize blog post, X thread, per-subreddit posts, HN title + first comment, canned-answers doc. Record final video/GIFs against the polished UI. Tag the release version; verify `npx` from clean cache one last time. | Working `npx` cold path: **BLOCKER** |
| **L-1** | Publish blog post (unlisted/live but unannounced). Sleep. | — |
| **L-day** | 8–9am ET: Show HN. +1h: X thread. +2h: r/ClaudeAI. Midday: Discord shares. All-day: reply to everything. | — |
| **L+1 → L+7** | Newsletter follow-ups with HN link; r/cursor and r/ChatGPTCoding posts; triage issues daily; ship a fast v0.1.x with launch-week fixes (visible responsiveness is itself marketing). | — |
| **L+7 → L+30** | Deep-dive blog post #2 (localhost security design); YouTuber outreach; weekly metrics ritual; first "what's next" Discussions post. | — |

**Launch-blocking summary:** (1) name decision, (2) README screenshots/GIF,
(3) Signal Grid vs. Console naming consistency, (4) SECURITY.md + disclosure
channel, (5) clean `npx` cold-start on the QA matrix, (6) zero known
crash-on-launch bugs from soft launch.

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **The name.** `agentconfiging` reads like a typo of "agent configuring," is hard to say aloud, and is weak for SEO (search engines will "correct" it). The repo directory is even `agentconfig`, suggesting the natural name was taken. | **RESOLVED (2026-08-01)** — variant of option (b). | The domain is **agentconfig.ing**, a domain hack that spells the package name — so the display brand is "agentconfig.ing" everywhere (H1s, OG images, social posts), which makes the name read intentional instead of typo'd and teaches the spelling of `npx agentconfiging`. Residual mitigations still owed: put "agent config" as separate words in the site `<title>`/meta so generic search can find it; **`agentconfig` on npm is a live unrelated package (v1.1.x), so `npx agentconfig` runs someone else's code** — always ship the command as copy-paste text, mention the `.ing` spelling in launch posts, and consider registering the free `agent-config` name as a defensive alias/pointer. |
| **Security scrutiny on HN.** A localhost server with filesystem write access and a PTY is exactly the shape of past real-world CVEs; the top comment may be adversarial. | High-probability, survivable | This is also the opportunity: the threat model is genuinely strong (token auth, Origin checks, canonical-path guards, redaction, PTY only in interactive mode). Preempt it — put the security model in the Show HN first comment, link SECURITY.md, and invite probing. A calm, technically precise reply to the first security comment often becomes the thread's tone-setter. Consider inviting one security-minded friend to review before L-day. |
| **Fast-moving space: vendors ship overlapping features.** Anthropic, Cursor, et al. could absorb config linting, marketplaces, or session views natively at any time. | Medium-high, ongoing | The durable moat is being **cross-runtime and vendor-neutral** — no single vendor will ever manage its competitors' config files. Keep instruction sync and multi-runtime detection at the center of the message; treat single-runtime features (e.g. Claude session replay) as hooks, not the identity. Ship detection/sync targets for new tools fast; each new runtime is a news beat. |
| **Feature breadth reads as bloat / "AI-generated shovelware" skepticism.** 2026 HN is primed to dismiss sprawling AI-adjacent tools. | Medium | Lead with two pillars (local-only + lint/fix), demo depth not breadth, and be candid about roughness. The clean-room note, real security model, and graceful native-module degradation are the tells of a cared-for project — surface them. Don't list all 14 pipeline node types in launch copy. |
| **Crowded adjacent tooling; "how is this different from X" fatigue.** Users may pattern-match to a usage-dashboard or a rules-sync script they already have. | Medium | Have crisp, generous one-line answers ready for the 4–5 likely comparisons (usage analytics tools, rules-sync utilities, GUI wrappers, plugin marketplaces, plain AGENTS.md). Formula: "X is great at Y; this is the layer that does Y *plus* inspect/fix/sync in one local surface." Never disparage. |
| **Launch-day defect on someone's weird repo** (exotic config crashes the scanner in a public thread). | Medium | Soft launch exists for this. Also: the engine treats config as adversarial data — make sure a parse failure degrades to a finding, not a crash, and that the log file makes bug reports one-paste. |
| **Windows support gaps** (paths, PTY, native modules). | Medium | Know the honest answer before L-day and put it in the FAQ. "Windows: works except X, tracked in #NN" beats discovering it in the HN thread. |
| **Single-maintainer bandwidth** — launch week attention exceeds one person. | Medium | Pre-written canned answers, issue templates that self-triage, response SLOs scoped to 48 hours of full focus, and a public "here's the roadmap" Discussion to redirect feature stampedes. It's fine to say "great idea, filed." |
| **A muted launch** (HN post doesn't stick). | Low-severity, plan for it | HN allows re-submission after a genuinely new version; a "Show HN" that flops quietly costs almost nothing. Fall back to the content tail: newsletters, deep-dive post #2, YouTubers, and a v0.2 re-launch beat in 6–8 weeks. |

---

## Appendix A — Draft copy blocks

**Show HN title:**
`Show HN: Agentconfiging – a local control center for AI agent config (npx, no cloud)`

**HN first-comment skeleton:** why I built it (personal config-drift pain) →
what it does in 4 bullets → the security model in full (localhost + token +
Origin checks + diff-previewed writes + redaction + PTY boundaries) → what's
rough / not done → what feedback I want.

**Elevator answers:**
- *"Why not just AGENTS.md?"* — AGENTS.md solves the instruction file; it says
  nothing about settings, hooks, MCP servers, skills, or whether any of it is
  broken. We support AGENTS.md as a source of truth and lint everything else.
- *"Does anything leave my machine?"* — No. `127.0.0.1`, no accounts, no
  telemetry, secrets redacted before the wire, and the CI `report` output
  never contains file contents.
- *"Is this another AI wrapper?"* — There's no model call in the product. It's
  a config tool: parse, lint, diff, write.

## Appendix B — Open decisions

1. ~~Name: rename / display-name / lean-in~~ **RESOLVED 2026-08-01: keep
   `agentconfiging`; brand as the domain hack agentconfig.ing (see §8 row 1).**
2. L-day date (pick a Tue/Wed ~4 weeks out; avoid vendor-event weeks).
3. Blog host (GitHub Pages vs. existing personal blog).
4. Whether the soft-launch Discords include Anthropic's official community
   server (read its self-promo rules first).
