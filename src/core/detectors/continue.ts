/**
 * Continue detector — port of `detectors/continue.ex`.
 *
 * Signals: a config file (.continue/config.json|yaml|yml) or any file
 * under .continue/. Confidence: config file present → high, dir-only →
 * medium (no low tier in the source).
 *
 * Global scope: a manifest rooted at ~/.continue carries the same layout
 * without the '.continue/' prefix; `dirPrefix` normalizes that.
 *
 * Extras: model names extracted from the FIRST present config path, JSON
 * only (same as the Elixir source — the YAML config is not parsed; no
 * yaml dependency in this package).
 *
 * Extension over the Elixir source: a root `.continuerules` file
 * (legacy rules format, present in the canonical continue-basic fixture)
 * is added to `files` when the detector already matched. It is NOT a
 * match trigger on its own — faithful to the ported signal set.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { dirPrefix, filesUnder, findFile, hasDir, uniq } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.continue';
const CONFIG_NAMES = ['config.json', 'config.yaml', 'config.yml'];

function extractModels(m: Manifest, presentPaths: string[]): string[] {
  const first = presentPaths[0];
  if (first === undefined || !first.endsWith('.json')) return [];
  const content = findFile(m, first)?.content;
  if (typeof content !== 'string') return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    return [];
  }
  if (typeof decoded !== 'object' || decoded === null) return [];
  const models = (decoded as Record<string, unknown>)['models'];
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)['model']
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
}

export const continueDetector: Detector = {
  id: 'continue',

  matches(m: Manifest): boolean {
    const prefix = dirPrefix(m, DIR);
    return CONFIG_NAMES.some((name) => findFile(m, `${prefix}${name}`)) || hasDir(m, prefix);
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const present = CONFIG_NAMES.map((name) => `${prefix}${name}`).filter((p) => findFile(m, p));
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);
    const legacyRules = findFile(m, '.continuerules') ? ['.continuerules'] : [];

    return {
      kind: 'continue',
      confidence: present.length > 0 ? 'high' : 'medium',
      files: uniq([...dirFiles, ...legacyRules]),
      extras: {
        models: extractModels(m, present),
      },
    };
  },
};

registerDetector(continueDetector);
