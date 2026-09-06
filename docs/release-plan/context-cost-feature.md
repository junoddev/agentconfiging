# Feature plan — per-agent context cost with per-section deep links

**Date:** 2026-08-01 · **Origin:** maintainer request + `market-research.md`
("context rot" is the loudest recurring pain; a bloat score is Tier-1). This
extends the market-research feature `agentconfig-3hi` (CLAUDE.md bloat score)
into the sharper, more differentiated shape the maintainer asked for:

> "context rot, the amount of **initial context taken per agent**, and **links to
> those specific config sections**."

## Why this is strong

It turns the bloat *score* into an actionable loop: not just "your config is
big" but **"this agent starts with N tokens; here's the breakdown by section;
click to go trim the offender."** Read-only observers (ccusage, sniffly) can
report cost but can't act on it; single-vendor doctors don't see across
runtimes. This is the closed-loop, cross-runtime moat from `market-research.md`
made concrete for the #1 pain.

## What already exists (the head start)

`src/core/context-health/` already computes, for the **whole project** in
**bytes**:
- per-file + per-category totals (`categoryOf` → instructions/settings/rules/
  memory/skills/subagents/commands/mcp), a 48 KB budget, budget ratio/status,
  and a "largest contributors" list — surfaced at `#/context`
  (`web/src/pages/ContextHealth.tsx`) via `GET /api/context-health`.

Two things it does NOT do, which are this feature:
1. **Per agent** — it takes a raw `Manifest`, ignoring `DetectedAgent.files`.
2. **Tokens, and per section** — it sums whole-file *bytes*; no tokenizer
   exists in the repo, and it never descends below file granularity.

And one piece of infrastructure is missing entirely:
3. **Deep links** — `web/src/routes.ts` has no file- or section-level route
   param; editor file selection is local `useState`, not URL-addressable.

## Scope (beaded below)

**A. Token estimation foundation** *(shared with the `3hi` bloat score)*
Decide tokenizer dep vs. chars/4 heuristic. Recommendation: ship a fast
heuristic (chars/4, with a per-runtime fudge factor) behind one
`estimateTokens()` util so both this feature and `3hi` share it and we avoid a
heavy native tokenizer dep on the cold-start path. Revisit precision later.

**B. Core — per-agent context-cost pass**
Fork/extend `context-health.ts` to group by `DetectedAgent.files` and report
tokens per agent, per category, and a per-agent budget/status. New API route
beside `/api/context-health` + a `registry.ts` method.

**C. Per-section attribution**
Descend into instruction-file content: split by Markdown headings and follow
the `@import` graph (`ClaudeMd.imports` carries line numbers) so each
contributing *section* gets a token cost and a `{file, line}` address. This is
what makes the "links to specific config sections" real.

**D. Deep-link route infrastructure** *(the genuinely missing seam)*
Extend `Route`/`parseRoute`/`routeHash` in `web/src/routes.ts` with an optional
`file` (+ `line`/`section`) param, and teach the editor pages
(`Instructions.tsx` et al., via `useFileEditor`'s `selected`) to initialize
from it and scroll to the line. `web/src/state/agentScope.ts` `SECTION_KINDS`
maps a file to the right editor section. This unlocks deep links for findings
generally, not just this feature.

**E. Web — per-agent context tile + linked breakdown**
On `ContextHealth.tsx`: a per-agent "initial context" tile row (reuse
`StatBlock`), and a per-section contributors `Table` where each row deep-links
(via D) to the exact section. Optionally a compact tile on `Dashboard.tsx`.

## Sequencing & dependencies

```
A (token util) ──┬─> B (per-agent pass) ──> C (per-section) ──┐
                 └─> 3hi (bloat score, reuses A)               ├─> E (web breakdown)
D (deep-link routes, independent) ────────────────────────────┘
```

A is the shared foundation (also unblocks `3hi`). D is independent and reusable.
E needs B/C for data and D for the links. Ship order: A → (B, D in parallel) →
C → E.

## Launch-blocking split (DECIDED 2026-08-01)

Maintainer chose **token tile at launch, deep links follow**:

- **Launch-blocking:** A (`ub3.1` token util) + B (`ub3.2` per-agent pass) +
  E-lite (`ub3.5` per-agent context tile, no section links). Ships the headline
  "this agent starts with N tokens" number alongside the `3hi` bloat score.
  `ub3.1` is also a hard dependency of the launch-blocking `3hi`.
- **Fast-follow (post-launch):** C (`ub3.3` per-section attribution) + D
  (`ub3.4` file/section route infra) + `ub3.6` (linked per-section breakdown).
  The heavier addressing work stays off the launch critical path; when it lands
  it upgrades the tile into full click-to-section navigation.

Beads: epic `agentconfig-ub3`; `ub3.1/.2/.5` are P1 launch-blocking,
`ub3.3/.4/.6` are P2 fast-follow. `3hi` depends on `ub3.1`.
