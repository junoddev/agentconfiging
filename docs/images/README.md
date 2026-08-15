# Screenshots (TODO)

This directory is reserved for UI screenshots referenced by the top-level
[README](../../README.md) and [USAGE](../USAGE.md).

**No screenshots are committed yet** — the Signal Grid UI is best seen live. To
capture your own, run `npx agentconfiging` in a repo that has agent configuration
and grab the views below. Do not commit fabricated or mocked images.

Suggested captures (filenames the docs will expect):

| File | View | Alt text |
|---|---|---|
| `overview.png` | Inspector overview — detected runtimes with confidence meters and waveforms | "agentconfiging overview: detected runtimes with confidence meters" |
| `findings.png` | Findings list with an APPLY-fix row | "Findings list with a one-click APPLY fix" |
| `diff.png` | A write shown as a unified diff before commit | "Diff preview shown before a config write commits" |
| `sessions.png` | Session replay | "Session replay stepping through a past session" |
| `analytics.png` | Token/cost analytics with the cost widget | "Token and cost analytics with the persistent cost widget" |
| `pipelines.png` | React Flow pipeline builder | "Visual pipeline builder with node status" |

## Text depiction of the Signal Grid layout

Until real captures land, this is the shell (see [DESIGN.md](../DESIGN.md) §4):

```
+--------+-------------------------------------------------------------+
| AGENTCONFIG.ING    ~/projects/acme            ● LIVE  $2.14  [PAPER] | 48px top bar
+--------+-------------------------------------------------------------+
| 01 SIGNAL   |                                                        |
| 02 AGENTS   |    2                 3                14               |
| 03 FINDINGS |    AGENTS            WARNINGS         ARTIFACTS        | giant numeral
| 04 EDIT     |                                                        | stat blocks
| 05 CATALOG  |  ┌──────────────────────────────────────────────┐     |
| 06 SESSIONS |  │ CLAUDE CODE   ∿∿∿∿∿∿∿  ▮▮▮▯ HIGH   14 files   │     | SignalStrip
| 07 GIT      |  │ CURSOR        ∿∿∿∿∿    ▮▮▯▯ MED     6 files   │     | (waveform +
| 08 TERMINAL |  └──────────────────────────────────────────────┘     |  confidence)
| 09 PIPELINES|                                                        |
|             |  01 ■ settings.local.json is committed → add to        | FindingRow
| 220px rail  |       .gitignore                              [APPLY]  |
+-------------+--------------------------------------------------------+
```

Left rail numbers double as `Cmd+1..9` shortcuts. The chassis is static; only the
signal layer (waveforms, the LIVE dot, rescan sweeps) moves, and only in response
to real file events.
