# Signal Grid — the agentconfig design system

Swiss × Broadcast. A strict International-Style chassis — visible grid, timetable
typography, giant numerals, one red — carrying a live signal layer: waveform
traces, meters, and a pulse that exists because the tool genuinely watches your
files in real time. The chassis never moves; only the signal does.

## 1. Principles

1. **The config is the interface.** Every element corresponds to a real file,
   frontmatter field, or JSON key. No abstract dashboard-ware.
2. **Legibility earns trust before writes.** People let a tool edit
   `settings.json` only if its *reading* of the file felt precise. Density and
   exactness over friendliness.
3. **The chassis is static; the signal is alive.** Layout, type, and rules never
   animate. Waveforms, meters, the LIVE dot, and rescan sweeps are the only
   motion — and they move because something real happened on disk.
4. **Calm by default, loud only when it matters.** A healthy config is almost
   monochrome. Color budget is spent exclusively on signal and severity.
5. **One red.** Swiss discipline: a single accent red for errors/destructive
   actions, never decoration.

## 2. Color

Two first-class themes. Light is "Paper" (Swiss poster), dark is "Ink" (broadcast
console — deep ink-blue, never pure black).

| Token | Paper (light) | Ink (dark) | Use |
|---|---|---|---|
| `--bg` | `#FAFAF7` | `#0B0E17` | page field |
| `--surface` | `#FFFFFF` | `#121627` | cards, panels |
| `--fg` | `#141519` | `#E8EAF2` | primary text |
| `--fg-dim` | `#5C5F6A` | `#9AA1B5` | secondary text |
| `--hairline` | `#D9D9D2` | `#232A3E` | grid rules, borders (always 1px) |
| `--signal` | `#2E7D32` | `#B4FF39` | live traces, healthy, LIVE dot, confirmed writes |
| `--warn` | `#8A6100` | `#FFC53D` | warnings, VU high-range |
| `--red` | `#E63329` | `#FF4D3D` | errors, destructive, the only decorative-free accent |
| `--trace-dim` | `rgba(46,125,50,.25)` | `rgba(180,255,57,.22)` | waveform afterglow |

Rules: no gradients, no shadows (elevation = hairline + surface shift), no border
radius above 2px. Severity is the only place color appears in text.
`::selection` inverts to `--bg` on `--signal` (`--fg` fails contrast on the signal
color in both themes — ~1.02:1 in Ink; amended 2026-07-26 during 4f8.1).

## 3. Typography

- **Structure/sans**: `Archivo` (Google Fonts; grotesque in the Univers lineage).
  Weights 500/600/700. Tight tracking on headings (`-0.01em`).
- **Data/mono**: `IBM Plex Mono` 400/500/600. All file paths, keys, values, code,
  timestamps, and numerals-in-tables are mono.
- **Micro-labels**: 11px, all-caps, `+0.08em` tracking, `--fg-dim` — the
  timetable voice. Used for section headers, stat labels, column heads.
- **Giant numerals**: 64–96px Archivo 700, tabular lining figures, used for
  stat blocks only. The numeral is the hero; its label sits below in micro-label
  style.

Scale (px): 96 / 64 (stats) · 28 (page title) · 18 (section) · 15 (body) ·
13 (mono data) · 11 (micro-labels). Baseline grid 8px; line-heights snap to it.

## 4. Grid & layout

- 12-column grid, `max-width: 1440px`, 24px gutters; **column rules are visible**
  where content regions meet (1px `--hairline`), full-bleed horizontal rules
  between sections — the page reads like a printed timetable.
- Left rail navigation (fixed 220px): mono micro-labels, numbered `01 SIGNAL`,
  `02 AGENTS`, `03 FINDINGS`… numbers double as `Cmd+1..9` shortcuts.
- Top bar (48px): wordmark `AGENTCONFIG` (Archivo 700, tracked out), center =
  project path in mono, right = LIVE indicator + cost widget + theme toggle.
- Density: rows 40px; tables are hairline-ruled, no zebra striping.

## 5. The signal layer (Broadcast)

- **Waveform fingerprint**: each detected agent renders a small continuous trace
  whose shape is *deterministically derived from its config* (file sizes/hashes →
  amplitude sequence). It is a visual hash: the trace literally changes when the
  config changes, and pulses once on each file event. Canvas, 60fps, one color
  (`--signal`), `--trace-dim` afterglow.
- **Confidence/level meters**: segmented VU bars (`▮▮▮▯`) for detector
  confidence, token budgets, cache efficiency. Segments are 2px-gapped rects —
  never smooth progress bars.
- **LIVE dot**: 8px square (not a circle — Swiss) in `--signal`, 1.2s pulse,
  only while the watcher is connected. Disconnect flips it to hollow + `OFFLINE`.
- **Rescan sweep**: on watcher-triggered re-analysis, a 1px vertical line sweeps
  the affected panel once (300ms). No skeleton loaders anywhere.
- **Live session pulse**: a session JSONL currently growing gets the same pulse
  treatment in Session Replay lists.
- `prefers-reduced-motion`: traces freeze to their static shape, pulses become
  discrete state changes. Nothing is lost semantically.

## 6. Core components

| Component | Spec |
|---|---|
| `StatBlock` | giant numeral + micro-label + optional delta in mono; hairline-boxed |
| `SignalStrip` | agent row: kind (Archivo 600) · waveform canvas · confidence meter · file count |
| `FindingRow` | timetable row: 2-digit index (mono) · severity block (8px square, colored) · title · `→ fix` line · `[APPLY]` button when a machine fix exists |
| `FileChip` | mono path chip; click = open in artifact browser; hover shows size/sha |
| `DiffPanel` | unified diff, mono 13, add lines `--signal`, del lines `--red`; mandatory before any write; `[COMMIT]` / `[DISCARD]` |
| `CatalogCard` | registry entry: name, kind badge, description, install count, `[INSTALL]` → DiffPanel |
| `TerminalTab` | xterm.js themed to the active Signal Grid theme; tab strip in micro-labels |
| `PipelineCanvas` | React Flow, nodes as hairline boxes with micro-label headers; edges are 1px, right-angled (schematic, not bezier) |
| `Heatmap` | activity calendar in `--signal` opacity steps; squares, 2px gap |
| `EmptyState` | `NO SIGNAL` in giant numerals style + one-line instruction; flat-line waveform |
| `CommandPalette` | Cmd+K; mono list, numbered results, hairline modal, no blur/glass |

Buttons: rectangular, 2px radius, mono all-caps labels in brackets — `[APPLY]`,
`[COMMIT]`, `[INSTALL]`. Primary = `--fg` fill; destructive = `--red` fill;
everything else = hairline outline.

Charts (analytics): follow the dataviz skill conventions mapped onto Signal Grid
tokens — mono axis labels, hairline gridlines, `--signal`/`--warn`/`--red` as the
categorical trio, no legends when direct labeling fits.

## 7. Voice

Terse, instrumental, lower-stakes NASA: `2 AGENTS · 3 WARNINGS · 14 ARTIFACTS`,
`SIGNAL ACQUIRED`, `WRITE COMMITTED`, `NO SIGNAL`. Never cute, never apologetic.
Findings speak in the imperative: "add `.claude/settings.local.json` to
.gitignore."

## 8. The CLI (Ink)

Signal Grid translated to the terminal. Same voice (§7), same discipline: static
chassis, moving signal.

- **Layout**: header line (`AGENTCONFIG · <n> instances · <url>`), instance list
  (name, agent count, finding count, `●` loaded / `○` lazy), and a log pane.
  Completed log lines render via Ink `<Static>` so they scroll into normal
  terminal history; only the bottom status region re-renders.
- **Color**: terminal-safe mapping of the tokens — signal green, warn yellow,
  error red, dim gray. One theme; respect `NO_COLOR` and non-TTY (plain lines,
  no Ink layout when piped).
- **Interactions (v1)**: arrow/j-k to select an instance, `enter` opens it in
  the browser, `a` add folder, `s` scan folder recursively, `q` quit
  (server keeps running with `--detach`). Everything else lives in the web UI.
- **Logs on disk**: everything shown in the log pane is also appended to
  `~/.local/state/agentconfiging/logs/<timestamp>.log`; the path is printed on
  startup and on crash.
- `report` and `daemon` never use Ink: plain JSON / plain timestamped lines.

## 9. What Signal Grid refuses

Gradients · glassmorphism · rounded cards · shadows · skeleton screens · spinners
(the sweep replaces them) · toasts that float over content (status changes happen
in-place, in the chrome's status line) · icon soup (type does the work; icons only
where space demands: severity squares, kind badges) · dark-mode-only design
(Paper is a first-class theme).
