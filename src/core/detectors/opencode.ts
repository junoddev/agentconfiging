/**
 * opencode detector — port of `detectors/opencode.ex`.
 *
 * Signals (match triggers, not counted): opencode.json, .opencode/ dir
 * presence. Confidence: fixed 'medium' (as in the Elixir source).
 *
 * Extras: `providers` as provider name strings from legacy `providers` lists,
 * legacy `provider` strings, or current-schema `provider` maps; `model` added on top because the
 * current opencode config schema (and the canonical opencode-basic
 * fixture) uses a "provider/model" `model` field instead.
 *
 * Global scope: a manifest rooted at ~/.opencode carries the same layout
 * without the '.opencode/' prefix; `dirPrefix` normalizes that.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { dirPrefix, filesUnder, findFile, hasDir, uniq } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.opencode';
const CONFIG = 'opencode.json';

function decodeConfig(m: Manifest): Record<string, unknown> | undefined {
  const content = findFile(m, CONFIG)?.content;
  if (typeof content !== 'string') return undefined;
  try {
    const decoded: unknown = JSON.parse(content);
    if (typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)) {
      return decoded as Record<string, unknown>;
    }
  } catch {
    // Malformed config: tolerated, extras stay empty.
  }
  return undefined;
}

function extractProviderName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const name = (entry as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return undefined;
}

function extractProviders(config: Record<string, unknown> | undefined): string[] {
  if (config === undefined) return [];
  if (Array.isArray(config['providers'])) {
    return config['providers'].map(extractProviderName).filter((name): name is string => {
      return name !== undefined;
    });
  }
  if (typeof config['provider'] === 'string') return [config['provider']];
  if (
    typeof config['provider'] === 'object' &&
    config['provider'] !== null &&
    !Array.isArray(config['provider'])
  ) {
    return Object.keys(config['provider']);
  }
  return [];
}

export const opencodeDetector: Detector = {
  id: 'opencode',

  matches(m: Manifest): boolean {
    return findFile(m, CONFIG) !== undefined || hasDir(m, dirPrefix(m, DIR));
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const hasConfig = findFile(m, CONFIG) !== undefined;
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);
    const config = decodeConfig(m);

    const extras: Record<string, unknown> = { providers: extractProviders(config) };
    if (typeof config?.['model'] === 'string') {
      extras['model'] = config['model'];
    }

    return {
      kind: 'opencode',
      confidence: 'medium',
      files: uniq([...(hasConfig ? [CONFIG] : []), ...dirFiles]),
      extras,
    };
  },
};

registerDetector(opencodeDetector);
