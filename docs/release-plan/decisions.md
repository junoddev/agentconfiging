# Release decisions log

Decisions made by the maintainer; the four plan files have been updated in
place where they flagged these as open gates.

## 2026-08-01

1. **Name & domain: keep `agentconfiging`, brand as agentconfig.ing.**
   The domain is a hack that spells the package name, resolving the
   "reads like a typo" risk. Display brand is `agentconfig.ing` in all
   public copy; the npm package and command stay `agentconfiging`.
   - Hazard: `agentconfig` on npm is an unrelated live package (v1.1.x), so
     `npx agentconfig` runs someone else's code. Ship the command only as
     copy-paste text; `agent-config` is free and can be registered as a
     defensive alias.
   - SEO note: the domain fixes brand perception and branded search; ranking
     for generic terms ("agent config manager") still depends on site
     content/meta, not the domain.

2. **Design system: Console. "Signal Grid" is deprecated.**
   README and SPEC.md still market Signal Grid and need rewriting to
   Console before any public copy ships.

3. **npm permissions/token setup: owned by maintainer** (in progress as of
   this entry). Blocks the tag-driven publish workflow dry-run.

4. **Two feature gaps are now launch-blocking** (from `market-research.md`):
   (a) **token/cost tiles** — highest-volume market pain, reuses the session
   JSONL we already parse; (b) **CLAUDE.md quality/bloat score (0–100)** —
   answers "context rot", now competitive table stakes, fits the analyzer
   framework. Both chosen launch-blocking to close table-stakes gaps and carry
   the "closes the loop" narrative.

5. **Per-agent context cost — token tile launch-blocking, deep links
   fast-follow** (from `context-cost-feature.md`). Epic `agentconfig-ub3`.
   Launch-blocking: shared token util (`ub3.1`, also required by `3hi`),
   per-agent context-cost pass (`ub3.2`), per-agent token tile (`ub3.5`).
   Post-launch fast-follow: per-section attribution (`ub3.3`), file/section
   deep-link route infra (`ub3.4`), linked per-section breakdown (`ub3.6`).
   Builds on the existing `src/core/context-health/` byte-level pass.

6. **Repositioning adopted** (from `market-research.md`): lead with the
   cross-runtime closed loop, not lint-in-isolation; reframe "sync" →
   "reconcile + govern"; never market redaction as "secret scanning"; treat the
   marketplace as an aggregator, not a store; position git/terminal as
   complementary to session-manager GUIs, not a competitor.

## Still open

- L-day date (Tue/Wed, ~4 weeks out, avoid vendor-event weeks).
- Blog host for the launch post.
- Whether soft-launch Discords include Anthropic's official server.
- Unscoped vs. `@capabletooling` scope for the npm package (bead
  `agentconfig-fy8.3`) — note the package name itself is now settled.
