import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeTokens } from './tokens.js';

/** The DESIGN.md §2 table, verbatim. If the spec changes, change it here too. */
const spec = {
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

/** Case/whitespace/leading-zero-insensitive color comparison. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/\b0\./g, '.');
}

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function cssBlock(selectorPattern: RegExp): string {
  const match = css.match(selectorPattern);
  if (!match?.[1]) throw new Error(`selector not found in tokens.css: ${selectorPattern}`);
  return match[1];
}

const blocks = {
  paper: cssBlock(/\n:root \{([^}]*)\}/),
  ink: cssBlock(/:root\[data-theme='ink'\] \{([^}]*)\}/),
  inkMedia: cssBlock(
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='paper'\]\) \{([^}]*)\}/,
  ),
};

function cssValue(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`token ${token} not found in block`);
  return match[1].trim();
}

describe('Signal Grid color tokens (DESIGN.md §2)', () => {
  for (const theme of ['paper', 'ink'] as const) {
    it(`tokens.ts ${theme} matches the DESIGN.md table exactly`, () => {
      expect(themeTokens[theme]).toEqual(spec[theme]);
    });

    it(`tokens.css ${theme} theme matches tokens.ts`, () => {
      for (const [token, value] of Object.entries(themeTokens[theme])) {
        expect(normalize(cssValue(blocks[theme], token)), token).toBe(normalize(value));
      }
    });
  }

  it('prefers-color-scheme dark fallback carries the full Ink set', () => {
    for (const [token, value] of Object.entries(themeTokens.ink)) {
      expect(normalize(cssValue(blocks.inkMedia, token)), token).toBe(normalize(value));
    }
  });
});
