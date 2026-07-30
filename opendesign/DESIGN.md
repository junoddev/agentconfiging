# agentctl design system — "Console"

A terminal-adjacent system-utility language extracted from `agentctl-config-console.html`.
Posture: information per square inch, not vibes. Data-dense, mono-detailed, one green accent,
hairline borders everywhere. Dark is the native mode (the tool is launched from a terminal);
light is a first-class inverse, not an afterthought.

---

## 1. Color tokens

Six core tokens + derived tints. **No raw hex anywhere** — core values are `oklch()`,
everything else is `color-mix(in oklch, …)` of a core token. Theme switching is a single
`data-theme` attribute on `<html>`; components never reference a theme directly.

```css
:root {
  --bg:      oklch(98% 0.005 250);   /* page canvas */
  --surface: oklch(100% 0 0);        /* cards, chrome, raised areas */
  --fg:      oklch(22% 0.02 240);    /* primary text */
  --muted:   oklch(50% 0.018 240);   /* secondary text, labels, captions */
  --border:  oklch(90% 0.008 240);   /* hairlines, dividers */
  --accent:  oklch(58% 0.16 145);    /* the ONE brand accent — green */

  /* status — derived hues, restrained tinted backgrounds only */
  --warn:    oklch(62% 0.14 85);
  --danger:  oklch(56% 0.19 25);

  /* soft washes — always color-mix, never new hex */
  --accent-soft: color-mix(in oklch, var(--accent) 14%, transparent);
  --warn-soft:   color-mix(in oklch, var(--warn) 16%, transparent);
  --danger-soft: color-mix(in oklch, var(--danger) 14%, transparent);
  --fg-soft:     color-mix(in oklch, var(--fg) 6%, transparent);
}
html[data-theme="dark"] {
  --bg:      oklch(17% 0.012 245);
  --surface: oklch(21% 0.014 245);
  --fg:      oklch(93% 0.008 240);
  --muted:   oklch(64% 0.015 240);
  --border:  oklch(30% 0.014 245);
  --accent:  oklch(72% 0.17 148);    /* accent lifts in lightness+chroma on dark */
  --warn:    oklch(76% 0.14 85);
  --danger:  oklch(66% 0.18 25);
}
```

**Accent budget.** The green accent is reserved for: active navigation (text + 2px left bar),
primary buttons, project-scope badges, live/connected status, and winning values in data
comparisons. It never appears as a large fill or background wash. Hover states use `--fg-soft`,
not accent.

**Status colors** appear only as pills/notices with `*-soft` backgrounds and the full-strength
hue as text. Never as solid fills.

---

## 2. Typography

```css
--font-display: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
--font-body:    same as display;   /* one sans family — utility trumps editorial */
--font-mono:    'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
```

Scale (fixed px — this is a desktop tool, not a marketing page):

| Role | Size / weight | Notes |
|---|---|---|
| Page title (h1) | 20px / 650 | letter-spacing −0.015em |
| Card / section head (h2) | 15px / 600 | |
| Body, controls | 13.5px / 400–550 | line-height 1.5 |
| Table cells (mono) | 12.5px | |
| Meta, captions | 12px mono, `--muted` | |
| Table headers, group labels | 10.5–11px mono, UPPERCASE, letter-spacing 0.05–0.09em | |
| Micro labels (chooser FOLDER/AGENT) | 10px mono, UPPERCASE, 0.08em | |

**Mono discipline** — mono is a semantic signal, not decoration. It marks: file paths, IDs,
hashes, branch names, commands, config keys/values, versions, timestamps, counts, and all
table headers/eyebrow labels. Numerics always get `font-variant-numeric: tabular-nums`.
Prose, titles, and button labels stay sans.

---

## 3. Space, shape, elevation

- **Radii:** `--radius: 8px` (controls, inputs, buttons), `--radius-lg: 12px` (cards, tables, dialogs), `999px` (pills only).
- **Spacing rhythm:** 4/8-based — control padding ≈ 6–8px vertical / 10–16px horizontal; card padding 18–20px; section gaps 12–22px.
- **Borders:** 1px `var(--border)` hairlines do all separation work. No drop shadows on resting cards.
- **Elevation** exists only for floating layers: dropdown menus (`0 12px 32px` fg-mix 18%), dialogs (`0 24px 60px` fg-mix 22%), active segmented thumb (`0 1px 2–3px` fg-mix ~12%).
- **Flourish (the only one):** content area carries a faint dot grid —
  `radial-gradient(color-mix(in oklch, var(--fg) 5%, transparent) 1px, transparent 1px)` at `26px 26px`.

---

## 4. App shell metrics

| Region | Spec |
|---|---|
| Topbar | 49px, `--surface`, bottom hairline; brand (mono, accent sigil) left, context chooser centered, utilities right |
| Sidebar | 232px, `--surface`, right hairline; grouped nav + scope legend pinned to bottom |
| Content | scrollable, dot-grid background, inner column max-width 980px |
| Statusbar | 30px, mono 11.5px `--muted`; pulsing live-dot + endpoint left, launch command center, config paths right |
| Breakpoint | ≤860px: sidebar hides, grids collapse to 2-col, micro labels drop |

---

## 5. Components

Class names are the contract — reuse them, don't reinvent.

- **Context chooser** (`.chooser` / `.ch-side` / `.ch-menu` / `.ch-item`): one bordered control, two baseline-aligned sides (micro label + value + 9px caret) split by a hairline `.ch-div`. Menus drop 6px below, 250px min, 5px padding, 7px-radius items; active item = accent-soft bg + accent text.
- **Sidebar nav** (`.nav-item`): 7px/10px padding, transparent 2px left border; active = `--accent-soft` bg, accent left bar, 550 weight. Mono glyph (15px box) + label + mono count pushed right.
- **Scope badges** (`.scope.s-*`): the system's signature. 10.5px mono uppercase, 5px radius. `project` = accent-soft/accent · `user` = outlined neutral · `local` = warn-soft/warn. Every configurable row shows one — provenance is never implicit.
- **Status pills** (`.pill.p-*`): 999px radius, 11px mono. ok/connected = accent-soft · warn = warn-soft · error = danger-soft · disabled = fg-soft/muted.
- **Switch** (`.switch`): 34×19px track, 13px knob, 0.15s ease; on = accent track, surface knob.
- **Buttons** (`.btn-*`): primary = accent fill, `--bg` text (hover: mix 86% accent + fg); secondary = surface + hairline (hover: `--muted` border); ghost = muted text (hover: fg + fg-soft bg). All: 1px translateY on :active; disabled = 45% opacity, no pointer events.
- **Data tables** (`.ds-table` in `.table-card`): mono uppercase 11px headers, 9/12px cell padding, bottom hairlines only (no striping, no vertical rules), row hover `--fg-soft`, numeric columns right-aligned mono. Wrapped in a radius-lg hairline card.
- **List rows** (`.list-card` / `.list-row` / `.lc-head`): card with optional mono uppercase group header on fg-soft; rows = leading control (switch), title + inline badge, muted 12.5px sub-line (ellipsized), trailing meta + ghost action.
- **Filter chips** (`.chip-row` / `.chip`): recessed fg-soft track, active chip lifts to surface with subtle shadow.
- **Segmented options** (`.seg`): mono outlined buttons; selected = accent border/text/soft-bg. For enum settings (approval policy, sandbox mode).
- **Stat tiles** (`.tile`): 22px mono number + 12px muted label; hover raises border to `--muted`. Clickable wayfinding, not marketing stats.
- **Search input** (`.search`): surface + hairline, 6/11px padding; focus = accent border + 2px accent-soft ring (all inputs share this focus treatment).
- **Notices** (`.notice[-info]`): warn-soft or accent-soft wash, 35%-mix border, mono glyph mark (▲). Used for capability gaps ("Codex has no lifecycle hooks…").
- **Dialog**: head/body/foot with hairline separators, 560px max, backdrop = fg-mix 32% + 2px blur.
- **Toast**: inverted (`--fg` bg / `--bg` text), mono 12px, bottom-right, 2.2s, confirms every mutating action.
- **Pager** (`.pager`): meta "Showing x–y of n" left; Prev / `Page x / y` / Next right. Page size select adjacent to the search that feeds it.

---

## 6. Motion

Micro only. 0.12–0.15s `ease` on background/color/border; 0.05s translateY press on buttons;
2.2s box-shadow pulse on the live dot. No entrance animations, no easing theatrics, no parallax.

---

## 7. Voice & content rules

- Labels are nouns, buttons are verbs that say what happens ("Resume", "Add hook", "Save hook").
- Provenance is always visible: any value that comes from a file shows its scope badge and, where useful, its source path in mono.
- Adaptive terminology: name things what the underlying tool names them (Hooks / Plugins / Extensions / Notifications; CLAUDE.md / AGENTS.md). When a capability doesn't exist, say so in a notice and show the nearest equivalent — never fake parity.
- Empty/no-match states name the filter that caused them.

## 8. Don'ts

No gradients (beyond the dot grid), no purple washes, no emoji icons, no serif display,
no second accent, no row striping, no boxed borders around editorial lists, no drop shadows
on resting elements, no raw hex outside the token block, no invented metrics.
