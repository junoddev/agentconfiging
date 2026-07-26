/**
 * GitHub Copilot detector — port of `detectors/copilot.ex`.
 *
 * Signals (match triggers, not counted): .github/copilot-instructions.md,
 * .github/copilot/* presence. Confidence: fixed 'medium' (the Elixir
 * source never rated Copilot higher — a lone instructions file is a weak
 * fingerprint and there is no rich-tree layout to distinguish).
 *
 * Extension over the Elixir source: `.github/instructions/*.instructions.md`
 * (the newer path-scoped Copilot format, present in the canonical
 * copilot-basic fixture) is included in `files` when the detector already
 * matched. It is deliberately NOT a match trigger on its own — faithful
 * to the ported signal set.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { anyUnder, filesUnder, findFile, uniq, wordCount } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const INSTRUCTIONS = '.github/copilot-instructions.md';

export const copilotDetector: Detector = {
  id: 'copilot',

  matches(m: Manifest): boolean {
    return findFile(m, INSTRUCTIONS) !== undefined || anyUnder(m, '.github/copilot/');
  },

  extract(m: Manifest): DetectedAgent {
    const hasInstructions = findFile(m, INSTRUCTIONS) !== undefined;
    const dirFiles = filesUnder(m, '.github/copilot/').map((f) => f.path);
    const scopedInstructions = filesUnder(m, '.github/instructions/')
      .map((f) => f.path)
      .filter((p) => p.endsWith('.instructions.md'));

    return {
      kind: 'copilot',
      confidence: 'medium',
      files: uniq([...(hasInstructions ? [INSTRUCTIONS] : []), ...dirFiles, ...scopedInstructions]),
      extras: {
        instructionsWords: wordCount(m, INSTRUCTIONS),
        scopedInstructionsCount: scopedInstructions.length,
      },
    };
  },
};

registerDetector(copilotDetector);
