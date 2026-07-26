/** Signal Grid color tokens (docs/DESIGN.md §2), one entry per theme.
 *  Hand-kept in sync with tokens.css — tokens.test.ts fails on any drift
 *  between this module, the CSS, and the DESIGN.md table. */

export const themeTokens = {
  paper: {
    '--bg': '#FAFAF7',
    '--surface': '#FFFFFF',
    '--fg': '#141519',
    '--fg-dim': '#5C5F6A',
    '--hairline': '#D9D9D2',
    '--signal': '#2E7D32',
    '--warn': '#8A6100',
    '--red': '#E63329',
    '--trace-dim': 'rgba(46,125,50,.25)',
  },
  ink: {
    '--bg': '#0B0E17',
    '--surface': '#121627',
    '--fg': '#E8EAF2',
    '--fg-dim': '#9AA1B5',
    '--hairline': '#232A3E',
    '--signal': '#B4FF39',
    '--warn': '#FFC53D',
    '--red': '#FF4D3D',
    '--trace-dim': 'rgba(180,255,57,.22)',
  },
} as const;

export type ThemeName = keyof typeof themeTokens;
export type ColorTokenName = keyof (typeof themeTokens)['paper'];
