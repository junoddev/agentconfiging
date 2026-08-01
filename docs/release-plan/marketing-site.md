# Marketing Site Plan — `agentconfiging`

Status: proposal · Owner: TBD · Last updated: 2026-08-01

> **Design-language note (read first).** The brief for this plan referenced the
> "Signal Grid" design language. Per [docs/DESIGN.md](../DESIGN.md) (Appendix,
> E13 adoption decisions), Signal Grid has been **fully replaced by "Console"**:
> the decorative signal layer (Waveform, VuMeter, SweepOverlay, SignalStrip) was
> retired as violating "information per square inch, not vibes" and "no invented
> metrics." This plan therefore builds the site on the **Console** system — the
> one users will actually see when they run the tool — while allowing one
> carefully-scoped "live" motif in the hero (§4). If Signal Grid is
> resurrected for marketing, revisit §4 only; everything else stands.

---

## 1. Goals and audience

### The one action

Every page, section, and CTA exists to get a visitor to paste this into a
terminal:

```bash
npx agentconfiging
```

There is no signup, no waitlist, no download page, no pricing tier. The install
story *is* the CTA, which is a genuine competitive asset — the site's job is to
build enough trust and curiosity in under 30 seconds that running one command
feels obviously worth it.

Secondary actions (in priority order):

1. Star / visit the GitHub repo (social proof flywheel, contributor funnel).
2. Read the docs (USAGE.md) for people who want depth before running anything.
3. Try `agentconfiging report` in CI (the wedge for teams).

### Who lands here

| Persona | How they arrive | What they need to see |
|---|---|---|
| **The multi-runtime developer** — runs Claude Code + Cursor + Copilot, config drift everywhere | HN/Reddit/X link, word of mouth | "It detects all 8 runtimes and syncs instructions across them" + the security model |
| **The team lead / platform engineer** | Searching "manage CLAUDE.md across team", "agent config lint" | The 13 analyzers, `report` exit codes for CI, diff-previewed writes |
| **The security-conscious skeptic** | Any of the above, but reads the privacy section first | Localhost-only, per-session token, secrets redacted server-side, nothing uploaded — stated early and plainly |
| **The curious tinkerer** | GitHub trending, awesome-lists | The breadth: pipelines, embedded terminal, session analytics, marketplace |

### Success metrics (privacy-respecting; see §7)

- Copy-button clicks on the `npx` command (the single KPI).
- Outbound clicks to GitHub.
- npm weekly downloads and GitHub stars as lagging external indicators
  (no site instrumentation needed).

Explicit non-goals: email capture, cookie-based retargeting, A/B testing
infrastructure, a blog at launch.

---

## 2. Site structure / information architecture

A **single-page site plus two light auxiliary pages**. The product has one
audience action and no pricing/plans matrix, so a multi-page marketing site
would dilute it. Anchored sections double as nav.

```
/                       Landing (single page, anchored sections)
├── #hero               Headline, subhead, npx command with copy button, GitHub stars
├── #demo               Animated capture of the real UI (see §6)
├── #how-it-works       3-step strip: run → inspect → fix (with the report/CI variant)
├── #features           Feature tour — 6 cards mapped to the app's own nav areas
├── #runtimes           The 8 detected runtimes + 7 sync-target formats, as a logo/name grid
├── #security           "Nothing leaves your machine" — the trust section, given real estate
├── #ci                 `report` for CI: exit-code table, one YAML snippet
├── #faq                6–8 questions (see below)
└── #footer             GitHub, npm, docs links, MIT license, no dark patterns

/docs  → redirect (or direct links) to GitHub docs/USAGE.md — do NOT build a
         docs site at launch; the repo docs are good and canonical
/og     (not a page) — OG image assets served for link unfurls
404     Console-styled, one line, link home
```

### Section notes

- **Hero** contains the command *as the primary CTA* — a mono, bordered block
  with a copy button and a one-line reassurance directly beneath it:
  "Local only. No account. Nothing uploaded. MIT." GitHub button secondary.
- **Feature tour** maps 1:1 to the app's own information architecture so the
  site teaches the product's mental model before first launch: **Inspect ·
  Edit · Sync · Catalog · Sessions · Operate & Pipelines** (Operate and
  Pipelines share a card to keep it at six). Each card: noun label (Console
  voice), 2-line description, one static screenshot crop.
- **Security section** is a full section, not a footnote. This audience reads
  it. Content lifts directly from README's security model: localhost bind,
  per-session bearer token, canonical-path write guards, dry-run diffs,
  server-side secret redaction, deletes-to-trash, PTY never in daemon mode.
- **FAQ** (also doubles as long-tail SEO):
  - Does anything leave my machine? (No — expand.)
  - Do I need an account or API key? (No.)
  - What runtimes does it detect? / What about <X>? (8 detected + sync targets.)
  - Is it safe to let it write my config? (Diff preview, path guards, trash.)
  - Why does search/terminal say unavailable? (Optional native modules.)
  - Can I use it in CI? (Yes — `report`, exit codes.)
  - What data does the site itself collect? (Answer honestly per §7.)

---

## 3. Messaging

### Headline options (pick one; test informally, not with A/B infra)

1. **"Your AI agents have config. Now it has a control center."**
   — direct, names the category we're creating.
2. **"One command. Every agent config in your repo, inspected and fixable."**
   — leads with the install story and the action verb pair.
3. **"Stop tab-hopping between eight agent configs."**
   — pain-first; strongest for the multi-runtime persona, weakest for CI folks.
4. **"npx agentconfiging"** as the literal headline, with the subhead doing the
   explaining — bold, very on-brand for a terminal-native audience, risky for
   anyone who needs context. Viable if the demo capture is directly beneath.

Recommendation: **#1** as headline with the command block immediately visible;
#2 held as the OG-image/social variant.

### Subhead

> Run `npx agentconfiging` in any repo and get a local web UI over every agent
> runtime it detects — every config file parsed, every problem found, every fix
> one diff-previewed click away. Nothing leaves your machine.

### Core value props (page-ready phrasing)

1. **See everything at once.** Eight runtimes auto-detected — Claude Code,
   Cursor, Copilot, Codex, Continue, Aider, Gemini CLI, opencode — with every
   config artifact parsed and browsable, secrets redacted before they ever
   reach the browser.
2. **Find real problems, fix them in one click.** Thirteen analyzers catch
   broken `@import`s, shadowed rules, missing hook scripts, MCP commands not
   on PATH, committed `settings.local.json`, and more. Machine-fixable
   findings ship with an APPLY button — and every write shows you the diff
   first.
3. **One source of truth, synced everywhere.** Maintain instructions once and
   regenerate CLAUDE.md, AGENTS.md, `.cursorrules`, and a long tail of other
   formats from it. Drift becomes a finding with a one-click resolve.
4. **Private by architecture, not by policy.** Localhost only, random port,
   per-session token, no account, no telemetry, no upload. The tool cannot
   phone home because there is nowhere to phone.
5. **Grows into your workflow.** A CI-ready `report` command with severity
   exit codes, session analytics from real history, a git panel, an embedded
   terminal, and a visual pipeline builder with cron scheduling.

(If the page needs exactly 3, use 1, 2, 4 — breadth and sync are visible in
the feature tour anyway; privacy must never be cut.)

### Voice

Follow DESIGN.md §7: labels are nouns, buttons are verbs, no invented metrics,
no hype adjectives. Never claim numbers we don't have ("blazing fast",
"loved by thousands"). The site should read like the tool: precise, dense,
confident, dry.

---

## 4. Visual direction — carrying Console onto the site

The strongest possible marketing move is **the site looks exactly like the
product**, so first launch feels like stepping through the screenshot. The
Console system is unusually portable because it's token-driven.

### Direct reuse

- **Tokens verbatim** from `web/src/styles/tokens.css`: the six oklch core
  tokens + color-mix derivations, both themes. `data-theme` on `<html>`,
  **dark default** (matching the app and the terminal-native audience), with
  a theme toggle in the top bar — the toggle itself demos the product's
  Paper→light/Ink→dark heritage.
- **Typography discipline**: system sans for prose, self-hosted JetBrains Mono
  (woff2, 400/500/600 via `@fontsource/jetbrains-mono`) for everything
  semantic — commands, paths, exit codes, runtime names, section eyebrow
  labels (10.5–11px mono UPPERCASE letter-spaced, exactly like table headers
  in-app). Marketing exception: the headline may scale well past the app's
  20px h1 cap — the "fixed px, desktop tool" rule is an app rule; keep the
  *weights and tracking* (650, −0.015em) so it's recognizably the same face.
- **Component contract classes** where they fit: `.pill` status pills for the
  runtime grid ("detected" = accent-soft, "sync target" = outlined neutral —
  mirroring the in-app scope-badge distinction), `.btn-primary` for CTAs,
  `.notice` for the security callout, `.ds-table` for the exit-code table,
  hairline `--border` cards with `--radius-lg` throughout.
- **The one flourish**: the faint dot grid
  (`radial-gradient(fg 5% mix, 1px)` at 26px) as the page background —
  it's the system's signature texture and costs nothing.
- **Accent budget** holds: green appears only on the primary CTA, the copy
  confirmation, active nav, and "live" indicators. Never as a wash.
- **Don'ts carry over**: no gradients, no purple, no emoji icons, no second
  accent, no drop shadows on resting cards, no entrance-animation theatrics.

### The one earned "live" moment

Console retired decorative signal elements because the app must not invent
metrics — but the *hero demo is real product output*, so it earns motion:

- The hero's centerpiece is an **animated capture of the actual UI** (§6)
  inside a Console-styled window chrome (49px topbar, hairline borders,
  statusbar with the pulsing live-dot — the one animated element DESIGN.md
  kept).
- The pulsing live-dot may appear exactly once outside the capture: next to
  "runs on your machine" in the hero reassurance line.
- `prefers-reduced-motion` freezes everything and swaps the animated capture
  for a static poster frame, matching the app's own motion policy.

This keeps faith with "moves only because something actually happened" — the
thing that happened is a real recorded session.

### Logo / mark

No logo exists yet. Recommend a **pure-type wordmark**: `agentconfiging` in
JetBrains Mono 600 with the accent-green sigil the app's topbar brand already
uses (reuse it exactly). A geometric favicon derived from the sigil. Do not
commission an illustrated mascot — it would violate the whole system.

---

## 5. Tech stack recommendation

### Recommended: **Astro** (static output) on **Cloudflare Pages** (GitHub Pages as the zero-new-vendor fallback)

Rationale:

- **Astro** ships zero JS by default — this page needs exactly three islands
  (copy button, theme toggle, maybe a live GitHub-star count), and everything
  else is static HTML/CSS. Perfect Lighthouse scores are realistic, which
  matters for a page whose pitch is "fast, local, no bloat"; the site should
  embody the product's values.
- The repo already uses **Vite + React + TypeScript + Prettier/ESLint** —
  Astro is Vite-based and its islands can be React, so contributors reuse
  existing knowledge and the token CSS imports unchanged. Keep the site in
  this repo under `site/` (own `package.json`, excluded from the npm `files`
  allowlist, which already only ships `dist/`) so tokens and copy stay in
  lockstep with the product.
- **Cloudflare Pages**: free, fast global CDN, custom-domain + automatic TLS,
  deploy-on-push from GitHub, and (relevant to §7) built-in aggregate,
  cookie-less traffic analytics at the host level — meaning the page itself
  can ship **zero analytics JavaScript**. If adding a vendor is undesirable,
  **GitHub Pages** hosts the same static output with no new account at the
  cost of the host-level analytics and slightly weaker cache control.

### Alternative considered: **VitePress**

Would give docs-site rendering of the existing markdown almost for free and is
also Vite-based. Rejected for launch because its theming fights a bespoke
landing design, and we deliberately are *not* building a docs site yet (repo
docs are canonical). It becomes the leading candidate if/when a real docs site
is wanted — at which point the marketing page stays Astro and VitePress lives
at `/docs`. (Plain hand-rolled HTML/CSS was also considered — genuinely viable
for one page — but Astro adds component reuse and OG/meta hygiene for near-zero
cost.)

### Domain

- **DECIDED (2026-08-01): agentconfig.ing.** A domain hack that spells the
  package name — it reframes "agentconfiging" from typo-looking to intentional,
  and doubles as the display brand (render the product name as
  **agentconfig.ing** in the hero, OG images, and social copy). `.ing` is on
  the HSTS preload list (HTTPS-only), which suits the security story.
- Typo hazard to design around: `agentconfig` on npm is an **unrelated
  existing package** — so `npx agentconfig` runs someone else's code. Always
  present the install command as copyable text (never ask users to transcribe
  it), and consider registering the free `agent-config` npm name as a
  defensive alias.

---

## 6. Asset needs and production

The README already flags "Screenshots: TODO" with `docs/images/` as the
destination — site asset production should fill both needs in one pass.

### Inventory

| Asset | Use | Spec |
|---|---|---|
| Hero animated capture | `#demo` | 20–30s loop: launch command in terminal → browser opens → Overview with runtime confidence readings → open a finding → APPLY → diff preview → commit → toast. ~1280×800 recording area, dark theme |
| 6 feature screenshots | Feature tour cards | One per card (Findings list, an editor with diff preview, Sync status view, Catalog, Sessions dashboard/heatmap, Pipeline builder). Both themes captured; dark shown by default |
| Terminal capture | `#how-it-works` / CI section | `npx agentconfiging` and `agentconfiging report --pretty` output |
| Wordmark + favicon | Global | SVG wordmark per §4; favicon 32/180/512 + SVG |
| OG image | Link unfurls | 1200×630. Wordmark + headline #2 + the command in mono on the dot-grid dark background. One static image at launch (per-section OG images are a nice-to-have) |
| Social variants | X/HN/Reddit posts | The OG image + a 15s cutdown of the hero capture as MP4 |

### Production method

1. **Fixture repo first.** Build a small, realistic, *sanitized* demo repo with
   multi-runtime config (Claude Code + Cursor + Copilot), a couple of
   deliberately planted findings (a broken `@import`, a committed
   `settings.local.json`), and synthetic session history. All captures come
   from this fixture — never from a real project, even though redaction
   exists. Keep it at `site/fixtures/demo-repo/` (or a separate repo) so
   captures are reproducible when the UI evolves.
2. **Screenshots via Playwright script** against the fixture at fixed viewport
   (2x DPR), both themes, checked into `docs/images/` — reproducible
   re-capture after UI changes beats hand-cropping, and the repo already has
   browser-automation precedent (e2e smoke script). The project's own preview
   tooling can drive interim captures during design.
3. **Recording**: screen-record the scripted flow (macOS capture or
   Playwright video), export as **MP4/WebM `<video muted autoplay loop
   playsinline>`** — not GIF (10x the bytes, worse quality). Poster frame =
   first screenshot, doubles as the reduced-motion fallback.
4. **OG image**: static export from a Figma/HTML template using the tokens.
   No dynamic OG generation service — one page, one image.

---

## 7. SEO & analytics (privacy-respecting)

### SEO

- Static HTML with real content (Astro gives this for free); one `<h1>`;
  semantic sections; descriptive `<title>` ("agentconfiging — local control
  center for AI agent configuration") and meta description mirroring the
  subhead.
- **Structured data**: `SoftwareApplication` JSON-LD (name, OS, MIT license,
  `offers: 0`, repo URL) and `FAQPage` JSON-LD from the FAQ section.
- OG + Twitter card meta with the §6 image — most traffic will be link
  unfurls from HN/X/Reddit/Slack, so unfurl quality matters more than Google
  ranking at launch.
- Target queries via natural copy, not keyword stuffing: "CLAUDE.md manager",
  "sync CLAUDE.md and AGENTS.md and .cursorrules", "AI agent config lint",
  "MCP server config editor", names of all 15 runtimes/formats (the
  `#runtimes` grid does this legitimately).
- `sitemap.xml` + `robots.txt` (Astro integrations), canonical URL once the
  domain lands.
- Ensure the GitHub repo README links the site and vice versa — for this
  audience, the repo *is* a primary search surface.

### Analytics

The product's pitch is "no telemetry, nothing leaves your machine." The site
must not undercut that:

- **Zero cookies, zero client-side analytics JS at launch.** Use
  Cloudflare Pages' host-level aggregate metrics (or none at all on GitHub
  Pages) plus npm download counts and GitHub traffic/stars as the dashboard.
- The one thing worth measuring client-side — copy-button clicks — can wait;
  if it's ever added, use a self-hosted or EU cookie-less counter (Plausible
  self-hosted / GoatCounter), declare it in the FAQ, and honor GPC. Not
  launch-blocking.
- No consent banner should ever be needed. If a proposed change would require
  one, reject the change.

---

## 8. Phased build plan

Estimates assume one person working part-time; a "day" ≈ a focused ~5-hour
block. Phases 0–2 are launch-blocking; 3–4 are not.

### Phase 0 — Decisions & skeleton (1 day) · LAUNCH-BLOCKING

- Pick headline (§3), confirm Console-not-Signal-Grid direction (§4), choose
  hosting/domain path (§5). Register domain if going that route.
- Scaffold `site/` with Astro; import `tokens.css` + JetBrains Mono; wire
  Cloudflare Pages (or Pages Actions) deploy-on-push with preview deploys.
- Verify: preview URL serves a tokens-styled "hello" page in both themes.

### Phase 1 — Assets (2–3 days, parallel with Phase 2) · LAUNCH-BLOCKING

- Build the sanitized fixture repo; script Playwright captures; take the 6
  screenshots + terminal capture; record and edit the hero loop; produce
  wordmark, favicon, OG image.
- Verify: all assets render crisply at 1x/2x; hero video < 4 MB; poster frame
  works with motion disabled; screenshots also land in `docs/images/`
  (closing the README TODO is a free win, done as its own change).

### Phase 2 — Page build (3–4 days) · LAUNCH-BLOCKING

- Implement all §2 sections; copy button, theme toggle; FAQ + JSON-LD; OG/meta;
  sitemap/robots; 404.
- Accessibility pass: keyboard-only walkthrough, `:focus-visible` ring (reuse
  the app's), contrast check on both themes, reduced-motion behavior.
- Performance gate: Lighthouse ≥ 95 across the board on a throttled run; no
  render-blocking font loads (`font-display: swap`, preload the two mono
  weights actually used).
- Verify: the page works with JavaScript disabled except copy/toggle niceties.

### Phase 3 — Launch (1 day) · LAUNCH-BLOCKING

- Domain + TLS live; README ↔ site cross-links; `package.json` `homepage`
  field; npm README rendering check; unfurl checks (X/Slack/Discord/HN);
  final copy proofread against the "no invented metrics" rule.
- Coordinated posts: Show HN, r/ClaudeAI / relevant subreddits, X thread with
  the 15s cutdown. (Post copy drafted in Phase 2.)

### Phase 4 — Post-launch (ongoing, nice-to-have)

- Live GitHub-star count island; per-section OG images; a "compare runtimes"
  capability matrix page; VitePress docs site at `/docs`; changelog/release
  notes page fed from GitHub Releases; copy-click counter per §7 if wanted;
  light localization of the README-level pitch if traffic warrants.

**Total to launch: roughly 7–9 focused days**, dominated by asset production —
start the fixture repo and captures first, since everything else can proceed
against placeholder boxes.

### Launch-blocking vs nice-to-have summary

| Launch-blocking | Nice-to-have |
|---|---|
| Single landing page, all §2 sections | Docs site, blog, changelog page |
| Hero capture + 6 screenshots + OG image | Per-section OG images, extra cutdowns |
| Copy-button CTA, theme toggle | Live star count, copy-click metrics |
| Security section + honest FAQ | Comparison/matrix pages |
| Lighthouse/a11y/reduced-motion gates | Localization |
| Domain or acceptable subdomain | Final domain if registration is slow |
