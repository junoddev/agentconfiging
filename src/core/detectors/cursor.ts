/**
 * Cursor detector — port of `detectors/cursor.ex`.
 *
 * Signals (2, counted): .cursorrules, .cursor/rules/* presence.
 * Confidence: 2 high, 1 medium, else low.
 *
 * Global scope: a manifest rooted at ~/.cursor carries the same layout
 * without the '.cursor/' prefix; `dirPrefix` normalizes that.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { dirPrefix, filesUnder, findFile, hasDir, uniq, wordCount } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.cursor';

function confidenceFor(signals: number): DetectedAgent['confidence'] {
  if (signals === 2) return 'high';
  if (signals === 1) return 'medium';
  return 'low';
}

export const cursorDetector: Detector = {
  id: 'cursor',

  matches(m: Manifest): boolean {
    return findFile(m, '.cursorrules') !== undefined || hasDir(m, dirPrefix(m, DIR));
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const hasCursorrules = findFile(m, '.cursorrules') !== undefined;
    const rules = filesUnder(m, `${prefix}rules/`);
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);

    const signals = [hasCursorrules, rules.length > 0].filter(Boolean).length;

    return {
      kind: 'cursor',
      confidence: confidenceFor(signals),
      files: uniq([...(hasCursorrules ? ['.cursorrules'] : []), ...dirFiles]),
      extras: {
        ruleCount: rules.length,
        hasCursorrules,
        cursorrulesWords: wordCount(m, '.cursorrules'),
      },
    };
  },
};

registerDetector(cursorDetector);
