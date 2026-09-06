---
target: our marketing page
total_score: 25
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 3
timestamp: 2026-08-23T13-35-41Z
slug: agentconfig-ing
---
# Marketing Page Redesign Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | Copy feedback exists, but theme state is ambiguous and copy success is not announced robustly. |
| 2 | Match system / real world | 3/4 | Strong developer language, with unexplained terms such as runtime, MCP, PTY, and canonical path. |
| 3 | User control and freedom | 3/4 | Clear anchors and controls on desktop; mobile removes section navigation entirely. |
| 4 | Consistency and standards | 4/4 | Console tokens, typography, components, and interaction patterns are highly cohesive. |
| 5 | Error prevention | 2/4 | The copyable command prevents transcription errors, but clipboard failure can still report success. |
| 6 | Recognition rather than recall | 3/4 | Core facts are visible, but detected runtimes versus sync targets rely on subtle styling without a legend. |
| 7 | Flexibility and efficiency | n/a | Not meaningful for a single-action Persuade surface. |
| 8 | Aesthetic and minimalist design | 2/4 | Repeated grids and cards flatten the hierarchy and interrupt the conversion narrative. |
| 9 | Error recognition and recovery | 2/4 | Clipboard failure lacks an honest, actionable fallback state. |
| 10 | Help and documentation | 3/4 | Docs and FAQ are visible; several technical concepts still need inline explanation. |
| **Total** | | **25/36** | **Acceptable — a strong system with a diluted funnel and insufficient product proof.** |

## Design Specificity Verdict

The page is authored for agentconfig.ing in its language and surface styling: JetBrains Mono semantics, dry technical copy, the literal command CTA, hairline Console surfaces, restrained green accent, runtime vocabulary, and diff/security language. Its composition is more category-interchangeable: oversized hero, CTA cluster, simulated console, card grids, logo grid, trust section, FAQ. The missing real product capture is the largest specificity gap.

The deterministic detector found 0 issues in `site/src/pages/index.astro`. That confirms the page avoids common implementation anti-patterns; it does not invalidate the higher-level hierarchy and persuasion issues. Browser overlays were unavailable because the in-app browser backend returned `Browser is not available: iab`; no user-visible overlay exists.

## Overall Impression

The first viewport feels precise, credible, and recognizably part of the product. The biggest opportunity is to turn the page from a well-styled product inventory into a confidence-building story: show the real product, move security forward, compress feature breadth, and end on the command.

## What's Working

1. The hero makes installation concrete with a copyable command and immediate local/no-account reassurance.
2. The Console design language creates continuity between marketing and first launch.
3. Security claims name real mechanisms—localhost binding, bearer token, path guards, dry-run diffs, trash, and server-side redaction—rather than generic privacy language.

## Priority Issues

### [P1] The demo provides too little real product proof

The visitor is being asked to run an unfamiliar package with a typo-sensitive name. A short handcrafted console cannot prove the local web UI, config breadth, finding quality, or diff-previewed write flow.

Replace it with a real, sanitized product capture showing detection → finding → diff preview → apply confirmation. Use a short loop with a static reduced-motion poster and one caption explaining the payoff.

Suggested command: `$impeccable bolder`

### [P1] The middle loses the single-action funnel

Six equal-weight feature cards, fifteen runtime pills, and the “Agent changes over time” timeline turn a focused landing page into a compact documentation index. Security—the objection most likely to block the command—arrives too late.

Move security directly after the demo or three-step explanation. Compress features into three outcome-led pillars, explicitly group runtime coverage as “Detected” and “Sync targets,” and move the change timeline to a deeper page or one proof link.

Suggested command: `$impeccable distill`

### [P1] The page does not close on conversion

After objections and proof, the page ends with FAQ and a passive utility footer. The final remembered action should be the command.

Add a concise closing section after FAQ with one earned line, the command/copy control, and local/no-account reassurance. Keep GitHub and docs secondary.

Suggested command: `$impeccable layout`

### [P2] Product distinctions depend on inference and jargon

Detected runtimes versus instruction targets is central product truth, but the distinction is mostly encoded in tint. Terms such as runtime, MCP, PTY, promoted, and canonical path slow first-time comprehension.

Add explicit group headings or a legend. Lead with benefits in prose and preserve exact technical terms as secondary detail.

Suggested command: `$impeccable clarify`

### [P2] Mobile adaptation removes wayfinding

Below 760px, navigation disappears while all grids become one long stack. Visitors cannot jump back to security, FAQ, or the install command.

Provide a compact section menu or sticky command action, reduce stacked repetition, preserve runtime grouping, and repeat the command at the end.

Suggested command: `$impeccable adapt`

## Persona Red Flags

**Jordan, first-timer:** The first action is clear, but runtime, MCP, PTY, canonical path, and the two runtime capability states are not defined where encountered. The simulated console assumes product knowledge instead of teaching the payoff.

**Riley, stress tester:** The mock output is not clearly labeled illustrative; copy can report success after failure; `localOnly: false` can appear to contradict “local only” without explanation; and absolute “nothing collected” language invites scrutiny against host logs and future analytics.

**Casey, mobile visitor:** Navigation vanishes, the primary action is not persistent or repeated, fifteen runtime items become fifteen stacked rows, and the long middle creates high scroll cost after interruption.

## Minor Observations

- “Paper / Ink” has personality but does not clearly name the current theme.
- “Detected now” and the live dot may imply a real scan inside a static demo.
- The active section is not reflected in sticky navigation while scrolling.
- Copy feedback lasts 1.8 seconds and lacks an explicit live region.
- Runtime pills should use semantic list/group structure, and the report exit-code display would benefit from table-like semantics.
- Exact computed contrast, fold composition, touch targets, LCP, CLS, and INP still need browser-based verification.

## Questions to Consider

- If the product UI is the strongest argument, why hide it behind an invented console?
- What remains if every section must increase confidence in running the command within 30 seconds?
- Is “Agent changes over time” an install argument, or a useful capability on the wrong page?
- Could security become part of the demo narrative by visibly showing redaction and diff review?
- Should the final memory be an ecosystem of capabilities, or the exact command the visitor is ready to run?
