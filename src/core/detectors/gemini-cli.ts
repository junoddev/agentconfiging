/**
 * Google Gemini CLI detector — port of `detectors/gemini_cli.ex`.
 *
 * Signals (2, counted): GEMINI.md, .gemini/ dir presence.
 * Confidence: 2 high, else medium (no low tier in the source).
 *
 * GEMINI.md vs AGENTS.md overlap: as in the Elixir source, AGENTS.md is
 * NOT a Gemini signal — a repo with only AGENTS.md detects as codex, not
 * gemini-cli (the multi-runtime fixture depends on this).
 *
 * Global scope: a manifest rooted at ~/.gemini carries the same layout
 * without the '.gemini/' prefix; `dirPrefix` normalizes that.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { dirPrefix, filesUnder, findFile, hasDir, uniq, wordCount } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.gemini';

export const geminiCliDetector: Detector = {
  id: 'gemini-cli',

  matches(m: Manifest): boolean {
    return findFile(m, 'GEMINI.md') !== undefined || hasDir(m, dirPrefix(m, DIR));
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const hasMd = findFile(m, 'GEMINI.md') !== undefined;
    const dirPresent = hasDir(m, prefix);
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);

    const signals = [hasMd, dirPresent].filter(Boolean).length;

    return {
      kind: 'gemini-cli',
      confidence: signals === 2 ? 'high' : 'medium',
      files: uniq([...(hasMd ? ['GEMINI.md'] : []), ...dirFiles]),
      extras: {
        geminiMdWords: wordCount(m, 'GEMINI.md'),
      },
    };
  },
};

registerDetector(geminiCliDetector);
