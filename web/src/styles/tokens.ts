/** Console color tokens (docs/DESIGN.md §1), one entry per theme.
 *  Hand-kept in sync with tokens.css — tokens.test.ts fails on any drift
 *  between this module, the CSS, and the docs/DESIGN.md token block. */

const light = {
  '--bg': 'oklch(98% 0.005 250)',
  '--surface': 'oklch(100% 0 0)',
  '--fg': 'oklch(22% 0.02 240)',
  '--muted': 'oklch(50% 0.018 240)',
  '--border': 'oklch(90% 0.008 240)',
  '--accent': 'oklch(58% 0.16 145)',
  '--warn': 'oklch(62% 0.14 85)',
  '--danger': 'oklch(56% 0.19 25)',
} as const;

const dark = {
  '--bg': 'oklch(17% 0.012 245)',
  '--surface': 'oklch(21% 0.014 245)',
  '--fg': 'oklch(93% 0.008 240)',
  '--muted': 'oklch(64% 0.015 240)',
  '--border': 'oklch(30% 0.014 245)',
  '--accent': 'oklch(72% 0.17 148)',
  '--warn': 'oklch(76% 0.14 85)',
  '--danger': 'oklch(66% 0.18 25)',
} as const;

export const themeTokens = {
  light,
  dark,
} as const;
/** Soft washes — theme-independent color-mix derivations of the core tokens
 *  (declared once in :root; they re-resolve when the theme flips). */
export const derivedTokens = {
  '--accent-soft': 'color-mix(in oklch, var(--accent) 14%, transparent)',
  '--warn-soft': 'color-mix(in oklch, var(--warn) 16%, transparent)',
  '--danger-soft': 'color-mix(in oklch, var(--danger) 14%, transparent)',
  '--fg-soft': 'color-mix(in oklch, var(--fg) 6%, transparent)',
} as const;

export type ThemeName = 'light' | 'dark';
export type ColorTokenName = keyof typeof light;
