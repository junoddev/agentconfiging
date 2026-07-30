import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derivedTokens, themeTokens } from './tokens.js';

/** Drift test: the Console token block must be identical in three places —
 *  tokens.ts (this module's source of truth for JS), tokens.css (what the app
 *  ships), and the docs/DESIGN.md §1 token block (the spec). */

/** Whitespace/quote-insensitive comparison; oklch/color-mix values verbatim. */
function normalize(value: string): string {
  return value.toLowerCase().replaceAll('"', "'").replace(/\s+/g, ' ').trim();
}

function block(source: string, selectorPattern: RegExp, label: string): string {
  const match = source.replaceAll('"', "'").match(selectorPattern);
  if (!match?.[1]) throw new Error(`selector not found in ${label}: ${selectorPattern}`);
  return match[1];
}

function cssValue(blockText: string, token: string): string {
  const match = blockText.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`token ${token} not found in block`);
  return match[1].trim();
}

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../../../docs/DESIGN.md', import.meta.url), 'utf8');

/** The spec's token block is the first ```css fence in docs/DESIGN.md. */
const docsFence = docs.match(/```css\n([\s\S]*?)```/)?.[1];
if (!docsFence) throw new Error('docs/DESIGN.md has no ```css token block');

const sources = {
  'tokens.css': {
    light: block(css, /:root \{([^}]*)\}/, 'tokens.css'),
    dark: block(css, /html\[data-theme='dark'\] \{([^}]*)\}/, 'tokens.css'),
  },
  'docs/DESIGN.md': {
    light: block(docsFence, /:root \{([^}]*)\}/, 'docs/DESIGN.md'),
    dark: block(docsFence, /html\[data-theme='dark'\] \{([^}]*)\}/, 'docs/DESIGN.md'),
  },
};

describe('Console color tokens (docs/DESIGN.md §1)', () => {
  for (const [name, blocks] of Object.entries(sources)) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${name} ${theme} theme matches tokens.ts`, () => {
        for (const [token, value] of Object.entries(themeTokens[theme])) {
          expect(normalize(cssValue(blocks[theme], token)), token).toBe(normalize(value));
        }
      });
    }

    it(`${name} declares the soft washes as color-mix of core tokens`, () => {
      for (const [token, value] of Object.entries(derivedTokens)) {
        expect(normalize(cssValue(blocks.light, token)), token).toBe(normalize(value));
      }
    });
  }

  it('no raw hex colors in web/src/styles outside the token block', () => {
    const dir = new URL('.', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      expect(/#[0-9a-fA-F]{3,8}\b/.test(text), `${file} contains raw hex`).toBe(false);
    }
  });

  it('the dark block overrides every core token (soft washes re-derive)', () => {
    expect(Object.keys(themeTokens.dark)).toEqual(Object.keys(themeTokens.light));
  });
});
