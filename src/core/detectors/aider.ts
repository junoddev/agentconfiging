/**
 * Aider detector — port of `detectors/aider.ex`.
 *
 * Signals (2, counted): .aider.conf.yml, .aiderignore (both repo-root
 * files; Aider has no project config dir).
 * Confidence: 2 high, 1 medium, else low.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { findFile } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const CONF = '.aider.conf.yml';
const IGNORE = '.aiderignore';

function confidenceFor(signals: number): DetectedAgent['confidence'] {
  if (signals === 2) return 'high';
  if (signals === 1) return 'medium';
  return 'low';
}

export const aiderDetector: Detector = {
  id: 'aider',

  matches(m: Manifest): boolean {
    return findFile(m, CONF) !== undefined || findFile(m, IGNORE) !== undefined;
  },

  extract(m: Manifest): DetectedAgent {
    const files = [CONF, IGNORE].filter((p) => findFile(m, p));

    return {
      kind: 'aider',
      confidence: confidenceFor(files.length),
      files,
      extras: {
        hasConf: findFile(m, CONF) !== undefined,
        hasIgnore: findFile(m, IGNORE) !== undefined,
      },
    };
  },
};

registerDetector(aiderDetector);
