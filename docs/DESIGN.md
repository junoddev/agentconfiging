# agentconfig.ing design system — "Console"

A terminal-adjacent system-utility language (adopted from `opendesign/DESIGN.md`
and its reference console mockup in `opendesign/` — the mockup's own branding is
replaced by **agentconfig.ing** everywhere in the app).
Posture: information per square inch, not vibes. Data-dense, mono-detailed, one green accent,
hairline borders everywhere. Dark is the native mode (the tool is launched from a terminal);
light is a first-class inverse, not an afterthought.

---

## 1. Color tokens

Six core tokens + derived tints. **No raw hex anywhere** — core values are `oklch()`,
everything else is `color-mix(in oklch, …)` of a core token. Theme switching is a single
`data-theme` attribute on `<html>`; components never reference a theme directly.
This block is pinned verbatim against `web/src/styles/tokens.css` and
`web/src/styles/tokens.ts` by `tokens.test.ts`.

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

**Themes.** `light` / `dark`; `:root` carries light, `html[data-theme="dark"]` overrides.
**Dark is the default** when neither a stored choice nor an OS preference exists.
`shell/theme.ts` resolves: stored choice → OS preference → dark; legacy Signal Grid
localStorage values migrate (`paper`→`light`, `ink`→`dark`).

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

JetBrains Mono 400/500/600 is self-hosted via `@fontsource/jetbrains-mono` (woff2 only);
the sans stack is pure system fonts — no sans font ships.

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
| Topbar | 49px, `--surface`, bottom hairline; brand (mono, accent sigil) left, persistent Folder chooser centered, utilities right |
| Sidebar | 232px, `--surface`, right hairline; folder-scoped grouped nav, Configure Agent chooser, scope legend pinned to bottom |
| Content | scrollable, dot-grid background, inner column max-width 980px |
| Statusbar | 30px, mono 11.5px `--muted`; see content spec below |
| Breakpoint | ≤860px: sidebar hides, grids collapse to 2-col, micro labels drop |

**Statusbar content** (all real values — no invented metrics):

- **Left:** pulsing live-dot + `connected`/`offline` from the websocket state, then the serve
  endpoint as `host:port` (plus ` · pid <n>` when `/api/health` provides one).
- **Center:** the launch command in mono — `npx agentconfiging <project path>`.
- **Right:** the active config paths (global `~/.claude` · project `./.claude`).

---

## 5. Components

Class names are the contract — reuse them, don't reinvent.

- **Folder chooser** (`.chooser` / `.ch-side` / `.ch-menu` / `.ch-item`): one persistent bordered control in the top bar. Folder is the application boundary and therefore remains visible on every route. Its menu drops 6px below, 250px min, 5px padding; active item = accent-soft bg + accent text.
- **Configure Agent chooser** (`.side-agent`): a compact bordered control directly below the Configure group label. It scopes only Configure and Library destinations; its remembered selection is not presented as the context of Folder, Activity, or Tools pages.
- **Agent-native terminology:** Library inventory labels adapt to the Configure agent. Claude Code uses “Plugins”; Codex and extension-oriented agents use “Extensions.” Sidebar, command palette, and page heading must resolve through the same terminology helper.
- **Sidebar nav** (`.nav-item`): 7px/10px padding, transparent 2px left border; active = `--accent-soft` bg, accent left bar, 550 weight. Mono glyph (15px box) + label + mono count pushed right.
- **Scope badges** (`.scope.s-*`): the system's signature. 10.5px mono uppercase, 5px radius. Every configurable row shows one — provenance is never implicit. See the scope mapping below.
- **Status pills** (`.pill.p-*`): 999px radius, 11px mono. ok/connected = accent-soft · warn = warn-soft · error = danger-soft · disabled = fg-soft/muted.
- **Switch** (`.switch`): 34×19px track, 13px knob, 0.15s ease; on = accent track, surface knob.
- **Buttons** (`.btn-*`): primary = accent fill, `--bg` text (hover: mix 86% accent + fg); secondary = surface + hairline (hover: `--muted` border); ghost = muted text (hover: fg + fg-soft bg). All: 1px translateY on :active; disabled = 45% opacity, no pointer events.
- **Data tables** (`.ds-table` in `.table-card`): mono uppercase 11px headers, 9/12px cell padding, bottom hairlines only (no striping, no vertical rules), row hover `--fg-soft`, numeric columns right-aligned mono. Wrapped in a radius-lg hairline card.
- **List rows** (`.list-card` / `.list-row` / `.lc-head`): card with optional mono uppercase group header on fg-soft; rows = leading control (switch), title + inline badge, muted 12.5px sub-line (ellipsized), trailing meta + ghost action.
- **Filter chips** (`.chip-row` / `.chip`): recessed fg-soft track, active chip lifts to surface with subtle shadow.
- **Segmented options** (`.seg`): mono outlined buttons; selected = accent border/text/soft-bg. For enum settings (approval policy, sandbox mode).
- **Stat tiles** (`.tile`): 22px mono number + 12px muted label; hover raises border to `--muted`. Clickable wayfinding, not marketing stats.
- **Search input** (`.search`): surface + hairline, 6/11px padding; focus = accent border + 2px accent-soft ring (all inputs share this focus treatment). Every other interactive element gets the shared keyboard-focus ring — a 2px accent outline via the global `:focus-visible` rule (`base.css`).
- **Notices** (`.notice[-info]`): warn-soft or accent-soft wash, 35%-mix border, mono glyph mark (▲). Used for capability gaps ("Codex has no lifecycle hooks…").
- **Dialog**: head/body/foot with hairline separators, 560px max, backdrop = fg-mix 32% + 2px blur.
- **Toast**: inverted (`--fg` bg / `--bg` text), mono 12px, bottom-right, 2.2s, confirms every mutating action.
- **Pager** (`.pager`): meta "Showing x–y of n" left; Prev / `Page x / y` / Next right. Page size select adjacent to the search that feeds it.

**Scope mapping.** agentconfig.ing's data model uses `project` and `global` scopes (the Console
mockup calls the machine-wide scope "user"). Badge classes and colors:

| agentconfig.ing scope | Badge | Treatment | Meaning |
|---|---|---|---|
| `project` | `.scope.s-project` | accent-soft bg / accent text | repo-level config (`./.claude`, `AGENTS.md`, `.mcp.json`) |
| `global` | `.scope.s-global` | outlined neutral (surface + hairline, muted text) | this machine's home-dir config (`~/.claude`, `~/.codex`, …) |
| `local` | `.scope.s-local` | warn-soft bg / warn text | uncommitted local overrides (`settings.local.json`) |

**Adding a component to the contract.** The internal gallery (`#/gallery`,
`web/src/gallery/`) is the living spec page: a component is not part of the contract until
every shipped state renders there. To add one:

1. Check the reference (`opendesign/agentctl-config-console.html`) and this section first —
   reuse an existing contract class before inventing a new one.
2. Implement it in `web/src/components/core/` with its styles in `components.css`
   (tokens only — no raw hex, radii from §3, no resting shadows), and export it from
   `web/src/components/core/index.ts`.
3. Extract any non-trivial logic into a DOM-free module (`foo.ts`) with a vitest unit test,
   mirroring `badge.ts` / `stat.ts`.
4. Add a demo block to `web/src/gallery/CoreSection.tsx` covering **every** state and variant,
   then verify it in both themes via the top-bar toggle.
5. Document it with a bullet in this section (§5) — class names are the contract.

---

## 6. Motion

Micro only. 0.12–0.15s `ease` on background/color/border; 0.05s translateY press on buttons;
2.2s box-shadow pulse on the live dot. No entrance animations, no easing theatrics, no parallax.
`prefers-reduced-motion` freezes everything (the live-dot becomes a static dot).

---

## 7. Voice & content rules

- Labels are nouns, buttons are verbs that say what happens ("Resume", "Add hook", "Save hook").
- Provenance is always visible: any value that comes from a file shows its scope badge and, where useful, its source path in mono.
- Adaptive terminology: name things what the underlying tool names them (Hooks / Plugins / Extensions / Notifications; CLAUDE.md / AGENTS.md). When a capability doesn't exist, say so in a notice and show the nearest equivalent — never fake parity.
- **Extension inventory terminology:** `#/extensions` is a normalized inventory
  surface, not a universal plugin manager. Use **plugins** for Claude Code,
  **extensions** for providers that use that term (such as the planned Gemini
  adapter), and **configuration artifacts** for Codex's `AGENTS.md`, rules, and
  config. Keep the agentconfig.ing Catalog distinct from provider-owned packages.
- **Capability states:** provider cards must distinguish `supported`, `detected`,
  `unavailable`, `unsupported`, and `error`. A missing provider CLI is an
  unavailable dependency; a provider without a lifecycle contract is unsupported.
  Never collapse those states or imply install/remove parity that the adapter does
  not implement.
- **Lifecycle safety boundary:** provider-managed install, remove, update, enable,
  and disable are opt-in capabilities. They are safe to expose only through a
  fixed-argument provider CLI/API with bounded execution, defensive parsing, and
  provider-owned uninstall. Read-only adapters must not direct-write provider
  plugin state or execute plugin code.
- Empty/no-match states name the filter that caused them.

## 8. Don'ts

No gradients (beyond the dot grid), no purple washes, no emoji icons, no serif display,
no second accent, no row striping, no boxed borders around editorial lists, no drop shadows
on resting elements, no raw hex outside the token block, no invented metrics.

## 9. The CLI (Ink)

Console translated to the terminal: same voice, same restraint.

- **Layout**: header line (`AGENTCONFIG.ING · <n> instances · <url>`), instance list
  (name, agent count, finding count, `●` loaded / `○` lazy), and a log pane.
  Completed log lines render via Ink `<Static>`; only the bottom status region re-renders.
- **Color**: terminal-safe mapping of the tokens — accent green, warn yellow,
  danger red, dim gray. One theme; respect `NO_COLOR` and non-TTY (plain lines,
  no Ink layout when piped).
- **Logs on disk**: everything shown in the log pane is also appended to
  `~/.local/state/agentconfiging/logs/<timestamp>.log`; the path is printed on
  startup and on crash.
- `report` and `daemon` never use Ink: plain JSON / plain timestamped lines.

---

## Appendix: E13 adoption decisions (agentconfig-4u1.1)

Recorded resolutions for the Signal Grid → Console migration:

- **(a) Full replacement.** No coexistence period; this document replaced the Signal Grid
  spec wholesale (`opendesign/` keeps the imported source). Components/pages migrate over
  E13.2–E13.6.
- **(b) Themes are `light`/`dark`, dark default.** `html[data-theme="dark"]`; dark is the
  native mode. `shell/theme.ts` migrates stored Signal Grid values `paper`→`light`,
  `ink`→`dark`.
- **(c) Signal layer retired.** Waveform / VuMeter / SweepOverlay / SignalStrip are decorative
  (violate "information per square inch, not vibes" and "no invented metrics") and are removed
  in E13.4–6. LiveDot survives, restyled as the statusbar live-dot. Heatmap survives (real
  data), restyled.
- **(d) Fonts.** Mono: self-hosted JetBrains Mono 400/500/600 via `@fontsource/jetbrains-mono`
  (IBM Plex Mono and Archivo packages dropped; 'IBM Plex Mono' remains in the stack only as a
  local fallback). Sans: system stack, nothing shipped.
- **(e) Statusbar content** per §4: ws-state live-dot + serve endpoint (host:port, + pid when
  `/api/health` provides it) left; `npx agentconfiging <path>` center; active config paths
  right. All values are real — no invented metrics.
