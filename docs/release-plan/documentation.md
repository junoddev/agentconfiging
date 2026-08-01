# Documentation Release Plan

Status: proposal, 2026-08-01. Scope: public documentation for the first npm
release of `agentconfiging`. Companion planning docs (marketing site, launch
comms) are tracked separately; this plan assumes the marketing site is a
separate effort and does **not** depend on it.

---

## 1. Audit of existing documentation

### What exists today

| File | Audience | State | Verdict |
|---|---|---|---|
| `README.md` | Public / npm page | Strong: value prop, install story, feature list, commands + exit codes, security model, supported runtimes, requirements | **Solid.** Near launch-ready. Gaps: screenshots (explicitly TODO), no links to a troubleshooting/FAQ doc, no contributing/support pointers, `package.json` lacks `repository`/`homepage` so the npm page won't link back. |
| `docs/USAGE.md` | Users | Good walkthrough: getting started, Ink TUI keys, instances, all 7 feature areas, `report` in CI, daemon, optional native modules | **Solid core**, but it is one monolithic page trying to be getting-started + 7 feature guides + CLI reference + CI guide at once. Fine at current length; will not scale, and none of it is screenshot-illustrated. |
| `docs/ARCHITECTURE.md` | Contributors | Accurate four-layer summary + security model + testing philosophy | **Solid** for its audience. Public-appropriate as a contributor doc. |
| `docs/SPEC.md` | Internal | Design/decision doc ("agreed direction", locked decisions, references to `../markdowning`, bead IDs) | **Internal.** Valuable history, but reads as a planning artifact. Keep in-repo, label clearly as a design doc; do not link from user-facing paths beyond the current "design doc" callout. |
| `docs/DESIGN.md` | Internal/contributors | Design-system spec (tokens pinned by tests). Note: header says "Console" adopted from `opendesign/`, while README/SPEC say "Signal Grid" | **Internal, and inconsistent** — the design-system naming drift (Signal Grid vs. Console) should be reconciled or at least explained before launch, since README markets "Signal Grid". |
| `docs/EXECUTION.md` | Internal | Agent-session operating manual (beads workflow, orchestration model) | **Internal-only.** Harmless to ship but should never be linked from public docs. Consider noting at top that it is a development-process doc. |
| `docs/LICENSE-AUDIT.md` | Maintainer/legal | Dependency license audit, clean-room statement | **Internal but publishable** — actually a trust asset. Link from a security/trust page. |
| `PUBLISHING.md` | Maintainer | Release runbook | **Internal.** Keep at root or move under `docs/release-plan/`; not user-facing. |
| `docs/images/README.md` | Contributors | Screenshot manifest: 6 named captures with alt text, plus an ASCII depiction | **Good scaffolding, zero images.** The capture list predates some naming in USAGE.md (e.g. `analytics.png` describes a "cost widget" not mentioned elsewhere) — reconcile the manifest with the shipped UI when capturing. |
| `AGENTS.md` / `CLAUDE.md` | AI agents | Repo instructions | Internal tooling; fine as-is. |

### What is missing for a public release

1. **Screenshots/recordings** — the single biggest gap. A visual tool with zero
   visuals in its README is a conversion killer, and the README itself admits it.
2. **Troubleshooting guide** — nothing covers: port/browser didn't open, token
   URL lost, native module build failures (`better-sqlite3`/`node-pty` on
   Windows/ARM/older glibc), watcher limits (inotify), "no runtimes detected",
   permission errors on global scope, WSL quirks.
3. **FAQ** — nothing answers the questions a security-conscious user will ask
   first: "does this phone home?", "why does it want a terminal?", "can I run it
   on a remote box?", "what exactly gets redacted?", "does APPLY change files
   without asking?".
4. **Dedicated security & privacy page** — the model is documented well but only
   as README/ARCHITECTURE sections. A tool that opens a localhost server with
   write access + PTY needs a standalone, linkable page, including a
   vulnerability-reporting channel (`SECURITY.md` is absent).
5. **CLI reference** — flags are scattered across README and USAGE
   (`--pretty`, `--global`, `--once`); nothing documents env vars
   (`AGENTCONFIGING_LOG_DIR`), state paths (`~/.local/state/agentconfiging/`),
   or the full exit-code contract in one canonical place.
6. **CI integration guide** — the `report` sections are good but there is no
   copy-pasteable GitHub Actions / GitLab CI example, no guidance on gating
   severity, no JSON schema or field reference for the report output.
7. **Report JSON reference** — CI users will parse the output; its shape is
   documented nowhere public.
8. **CONTRIBUTING.md and SECURITY.md** — standard OSS hygiene files; both absent.
9. **CHANGELOG.md** — absent; needed at v0.1.0 so release notes have a home.
10. **npm metadata** — `package.json` has no `repository`, `homepage`, `bugs`,
    or `keywords` visible; the npm listing will be an orphan. (Doc-adjacent but
    launch-blocking.)
11. **Pipeline/daemon operations guide depth** — 14 node types and templating
    (`{{input}}` / `{{NodeName}}`) get two paragraphs; users building automation
    that executes shell commands on a schedule deserve a real reference,
    including the security posture of scheduled execution.

### Honest overall assessment

The bones are unusually good for a pre-release project: README and USAGE are
accurate, current, and well-written, and the security story is told
consistently. The gaps are (a) everything visual, (b) everything that goes
wrong (troubleshooting/FAQ), (c) reference-grade material (CLI, report JSON,
pipeline nodes), and (d) OSS hygiene files. Nothing existing is wrong; the
problem is coverage, not quality.

---

## 2. Proposed public docs information architecture

All user-facing docs live under `docs/`, linked from a short index. Proposed
tree (new files marked ★):

```
README.md                     Front door: pitch, hero screenshot, quickstart,
                              feature tour (1 line + image each), links out.
CONTRIBUTING.md  ★            Dev setup, test/lint commands, PR expectations.
SECURITY.md      ★            Vulnerability reporting policy (GitHub standard
                              location; links to docs/security.md for the model).
CHANGELOG.md     ★            Keep-a-Changelog format, seeded with 0.1.0.

docs/
  index.md       ★            One-screen map of all docs by task ("I want to…").
  getting-started.md ★        Install, first launch, the token URL, the Ink TUI,
                              instances, first-five-minutes tour. (Split from USAGE.)
  guides/
    inspect.md   ★            Overview/agents/artifacts/findings + APPLY fixes.
    editors.md   ★            Every write-back editor; the diff-preview contract.
    sync.md      ★            Instruction sync: source of truth, targets, drift.
    catalog.md   ★            Catalog + marketplace, provenance, offline seed.
    sessions.md  ★            Dashboard, replay, search (sqlite note), context health.
    operate.md   ★            Git panel + terminal (node-pty note, PTY security).
    pipelines.md ★            Builder, all 14 node types, templating reference,
                              run history, cron/daemon scheduling.
  cli.md         ★            Canonical CLI reference: all three commands, every
                              flag, env vars, exit codes, log/state file paths.
  ci.md          ★            `report` in CI: GitHub Actions + GitLab examples,
                              severity gating, report JSON field reference,
                              `--global`/localOnly warning.
  security.md    ★            The local-only model, threat model, token auth,
                              write guards, redaction (what is and isn't caught),
                              PTY posture, adversarial-content stance. Links to
                              LICENSE-AUDIT.md as a trust artifact.
  troubleshooting.md ★        Symptom-indexed fixes (see §1 item 2 for seed list).
  faq.md         ★            Privacy, telemetry (none), remote use, data paths,
                              uninstall/cleanup, name ("agentconfiging"?).
  ARCHITECTURE.md             (exists) Contributor doc; link from CONTRIBUTING.
  SPEC.md, DESIGN.md,         (exist) Keep, labeled "design docs — may drift
  EXECUTION.md                from shipped behavior". Not linked from user paths.
  images/                     (exists) Captures land here per its README.
```

Rationale for granularity: one guide per left-rail area matches how users
experience the product (the rail *is* the IA), keeps each page
screenshot-friendly, and lets the future marketing/docs site adopt the same
structure 1:1.

---

## 3. Mapping: existing files → public docs

| Public doc | Source material | Work type |
|---|---|---|
| `README.md` | Itself | **Revise**: add hero screenshot + per-feature images, add links to new docs, trim the feature bullets slightly once guides exist. |
| `docs/getting-started.md` | USAGE.md §Getting started, §Ink TUI, §Instances | **Extract + expand** (add screenshots, "what you'll see" narration). |
| `docs/guides/*.md` (7) | USAGE.md §Feature areas (one subsection each) | **Extract + expand**: each subsection is 1–2 paragraphs today; guides need workflows, screenshots, and edge notes. Pipelines needs the most net-new (node reference). |
| `docs/cli.md` | README §Commands, USAGE `report`/`daemon` snippets, ARCHITECTURE CLI notes | **Consolidate + write fresh** (env vars, paths table are new). |
| `docs/ci.md` | README §report for CI, USAGE §report in CI | **Consolidate + write fresh** (workflow examples, JSON reference are new; JSON reference derived from `src/core` Report types). |
| `docs/security.md` | README §Security & privacy, ARCHITECTURE §Security model, SPEC redaction notes | **Consolidate + expand** (redaction specifics, threat-model framing, reporting pointer). |
| `docs/troubleshooting.md` | Nothing | **Write fresh** (mine issues from e2e scripts and optional-dep degradation paths). |
| `docs/faq.md` | Scattered README claims | **Write fresh.** |
| `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | Nothing (CONTRIBUTING can lift dev commands from package.json scripts + ARCHITECTURE testing section) | **Write fresh.** |
| `docs/USAGE.md` | — | **Retire after split**: replace body with a pointer stub to the new docs (preserve inbound links), or keep as a one-page condensed tour. Recommend the stub. |
| `docs/index.md` | — | **Write fresh** (short). |

Stays as-is: ARCHITECTURE.md (minor link updates), SPEC.md, DESIGN.md
(reconcile Signal Grid/Console naming first), EXECUTION.md, LICENSE-AUDIT.md,
PUBLISHING.md, docs/images/README.md (update manifest per §5).

---

## 4. Where docs live: in-repo markdown (recommendation)

**Recommendation: in-repo GitHub-rendered markdown for launch. No docs site now.**

Reasons:

- The marketing site is being planned separately; standing up a second web
  property (Docusaurus/Starlight/etc.) before launch duplicates that effort and
  creates a second deploy pipeline to maintain for a v0.1.0 audience.
- The audience installs via `npx` and lives in editors/terminals; GitHub-rendered
  markdown is where they will actually land (repo → docs/). npm's README render
  is the other front door, and it is markdown regardless.
- In-repo docs version with the code — a PR that changes a flag can change its
  doc in the same diff, which is the cheapest possible accuracy guarantee and
  feeds the quality gates in §6.
- The proposed `docs/` tree is deliberately site-shaped (index + guides/ +
  reference pages, one H1 per file, relative links). If/when the marketing site
  grows a docs section, these files can be ingested by any static-site generator
  with near-zero restructuring. Decide on a generator *then*, driven by the
  site's stack, not now.

Interim niceties (optional, cheap): enable the repo's GitHub Pages off `docs/`
only if the marketing team wants a stable `…/docs/` URL to link before the real
site exists; otherwise deep-link to GitHub blob URLs.

---

## 5. Screenshot & recording plan

Ground rules (already right in `docs/images/README.md`, keep them): capture the
real app against a real repo; **no fabricated/mocked images**. Add: capture in
a purpose-built demo repo (e.g. a small project configured with Claude Code +
Cursor + one MCP server, seeded findings) so captures are reproducible and
contain no personal paths/secrets; redaction must be verified in every capture;
capture both Paper and Ink themes only for the hero, one theme (Ink/dark — the
"native mode" per DESIGN.md) for the rest.

### Stills (launch-blocking set)

Revised manifest — supersedes the table in `docs/images/README.md` (update that
file when capturing):

| File | View | Used by |
|---|---|---|
| `hero.png` | Inspector overview, full shell (rail + top bar + stat blocks + SignalStrips) | README top |
| `findings.png` | Findings list with an APPLY row | README, guides/inspect |
| `diff.png` | Unified-diff preview modal before a write commits | README, guides/editors |
| `sync.png` | Instruction sync with per-runtime status indicators | guides/sync |
| `catalog.png` | Catalog with an install's diff/provenance preview | guides/catalog |
| `sessions.png` | Session replay | guides/sessions |
| `dashboard.png` | Analytics dashboard (heatmap/streaks) | guides/sessions |
| `terminal.png` | Git panel + embedded terminal | guides/operate |
| `pipelines.png` | React Flow builder with live node status | README, guides/pipelines |
| `tui.png` | The Ink terminal UI (instance list + log pane) | getting-started |

Format: PNG, 2x retina, consistent window size (recommend 1440×900 viewport),
each with the alt text committed alongside in the images README. Budget: one
half-day session once the UI is frozen for release.

### Recordings (post-launch, high leverage)

1. **30–45s hero GIF/webm** for the README: launch → overview → click a finding
   → APPLY → diff → commit. This is the single highest-conversion asset.
2. **Terminal cast** (asciinema or VHS) of `npx agentconfiging` and
   `agentconfiging report` — VHS (.tape files) preferred because recordings are
   scripted and therefore *re-recordable* when the UI changes.
3. Short per-feature clips for pipelines and sync, deferred until the docs site
   exists to host them (GIFs in-repo bloat clones; keep only the hero GIF
   in-repo, ~<3 MB).

Tooling note: the repo already has browser-preview MCP tooling available in
agent sessions; screenshot capture can be semi-automated, but a human should
approve every image against the "no fabricated images" rule.

---

## 6. Versioning, maintenance, and quality gates

### Versioning strategy

- Docs live on `main` and describe the latest released version; while pre-1.0,
  do not maintain versioned doc snapshots (cost >> benefit at this stage). Tag
  releases; users on old versions read the tag's tree.
- `CHANGELOG.md` (Keep a Changelog + semver) is the bridge between versions;
  every user-visible change lands there in the same PR.
- Behavior-changing PRs must touch the relevant doc in the same PR — enforce
  socially via a PR-template checkbox ("docs updated / not needed because…").

### Quality gates (automatable now)

1. **Link check**: `lychee` (or `markdown-link-check`) over `*.md` in CI —
   catches the broken relative links that a §3 restructuring will otherwise
   create. Launch-blocking gate.
2. **CLI truth check**: a small vitest that runs `agentconfiging --help` /
   `report --help` (or imports the commander definitions) and asserts every
   flag documented in `docs/cli.md` exists and vice versa. The repo already
   pins DESIGN.md tokens against source with `tokens.test.ts` — extend that
   proven pattern to the CLI surface.
3. **Exit-code contract test**: the `0/1/2/3/64` table appears in three places
   today; after consolidation it appears once in `docs/cli.md`, and an e2e
   asserts the codes (likely already partially covered by `npm run e2e`).
4. **Snippet lint**: fenced `bash` blocks in getting-started/ci docs get smoke
   run in CI where feasible (at minimum `report` examples).
5. **Image hygiene**: CI fails if a doc references a `docs/images/*` file that
   doesn't exist (cheap script), so the "screenshots TODO" state can never
   silently regress after launch.
6. **Prose linting** (optional, post-launch): Vale with a small style file
   (product name spelled `agentconfiging`, "local-only" hyphenation, no "simply").

### Ownership

Single-maintainer project today: docs review is self-review plus the gates
above. Add a `docs` issue label in beads (`bd`) and file a bead per §7 item so
progress is trackable with the rest of release work.

---

## 7. Prioritized work plan

Effort scale: S ≈ ≤half day, M ≈ 1 day, L ≈ 2–3 days.

### P0 — launch-blocking (order matters; ~5–7 focused days total)

| # | Item | Effort | Notes / verify |
|---|---|---|---|
| 1 | npm metadata: `repository`, `homepage`, `bugs`, `keywords` in package.json | S | `npm pack --dry-run` shows fields; npm page will link back. |
| 2 | `SECURITY.md` (reporting policy) + `docs/security.md` (consolidated model) | M | Threat model + redaction specifics reviewed against `src/` behavior. |
| 3 | Screenshot session: the 10 stills in §5 + update images README manifest | M | Every image referenced renders on GitHub; redaction visually verified. |
| 4 | README revision: hero image, feature images, doc links, support pointers | S | Renders correctly on both GitHub and npm (npm strips some HTML). |
| 5 | `docs/cli.md` canonical reference (flags, env vars, paths, exit codes) | M | Gate #2 test written alongside. |
| 6 | `docs/ci.md` with GitHub Actions example + report JSON field reference | M | Example workflow actually run once against the repo. |
| 7 | `docs/troubleshooting.md` (seed list in §1) + `docs/faq.md` | M | Covers both optional-native-module failure modes explicitly. |
| 8 | Split USAGE.md → `getting-started.md` + 7 guides + stub; add `docs/index.md` | L | Guides can be thin at launch (current USAGE prose + screenshot each); link-check gate green. |
| 9 | `CHANGELOG.md` seeded with 0.1.0; `CONTRIBUTING.md` | S | — |
| 10 | CI gates: link check + image-reference check | S | Red on a deliberately broken link. |

Minimum viable cut if time-boxed: items 1–7 + 9 ship launch; item 8 can ship as
"USAGE.md intact + guides split post-launch" without harming users, since
USAGE.md is already decent. Items 2–4 are non-negotiable for a security-sensitive
local tool.

### P1 — first two weeks post-launch (~4–5 days)

| Item | Effort |
|---|---|
| Hero GIF/webm + VHS tape for the CLI casts (re-recordable) | M |
| `docs/guides/pipelines.md` deepened: full 14-node reference, templating semantics, scheduling security notes | M |
| Report JSON: publish a JSON Schema (generated from types if practical) linked from ci.md | M |
| CLI truth test (gate #2) + exit-code e2e assertion (gate #3) if not done in P0 | S |
| Reconcile DESIGN.md "Console" vs. README "Signal Grid" naming; label SPEC/EXECUTION as internal design docs | S |
| FAQ/troubleshooting round 2 from real issue-tracker traffic | S |

### P2 — as demand appears

- Docs section on the marketing site (ingest `docs/` tree; generator chosen by
  the site's stack) — only when the site exists and traffic justifies it.
- Per-feature video clips; localized quickstart if international uptake shows.
- Versioned docs — only at/after 1.0 if breaking changes start landing.
- Prose linting (Vale) in CI.
- A "runtime support matrix" page auto-generated from `src/core/runtimes/`
  (detection vs. sync-only, per-artifact coverage) — high value, moderate build.

---

## Appendix: known inconsistencies to fix during the work

- Design-system name: README/SPEC say **Signal Grid**; DESIGN.md header says
  **"Console"** (adopted from `opendesign/`). **DECIDED 2026-08-01: Console;
  Signal Grid is deprecated — update README/SPEC accordingly.**
- `docs/images/README.md` capture list vs. shipped UI (e.g. `analytics.png`
  mentions a "cost widget" not described in USAGE.md) — reconcile at capture time.
- Exit-code and optional-module tables are duplicated across README/USAGE —
  after §3, each lives in exactly one canonical doc, others link.
- USAGE.md says "13 analyzers"; keep such counts in one place (or drop precise
  counts from prose) so they can't drift.
