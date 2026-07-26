/**
 * OpenAI Codex detector — port of `detectors/codex.ex`.
 *
 * Signals (3, counted): AGENTS.md, the config TOML, .codex/ dir presence.
 * Confidence: >=2 high, 1 medium, else low.
 *
 * AGENTS.md is a shared marker (other tools read it too) — as in the
 * Elixir source, AGENTS.md alone yields a single signal (medium), never
 * high; a .codex/ dir or config TOML alongside it is what pushes to high.
 *
 * Global scope adaptation (the Elixir engine had no global scope): a
 * manifest rooted at ~/.codex (cwdBasename '.codex') IS the .codex dir —
 * that counts as the dir signal, and the config file there is named
 * `config.toml` (the real Codex CLI global config) rather than the
 * project-root `codex.toml` the Elixir source checked.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { dirPrefix, filesUnder, findFile, hasDir, uniq, wordCount } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.codex';

function configPath(prefix: string): string {
  return prefix === '' ? 'config.toml' : 'codex.toml';
}

function confidenceFor(signals: number): DetectedAgent['confidence'] {
  if (signals >= 2) return 'high';
  if (signals === 1) return 'medium';
  return 'low';
}

export const codexDetector: Detector = {
  id: 'codex',

  matches(m: Manifest): boolean {
    const prefix = dirPrefix(m, DIR);
    return (
      findFile(m, 'AGENTS.md') !== undefined ||
      findFile(m, configPath(prefix)) !== undefined ||
      hasDir(m, prefix)
    );
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const named = ['AGENTS.md', configPath(prefix)].filter((p) => findFile(m, p));
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);

    const signals = [
      findFile(m, 'AGENTS.md') !== undefined,
      findFile(m, configPath(prefix)) !== undefined,
      hasDir(m, prefix),
    ].filter(Boolean).length;

    return {
      kind: 'codex',
      confidence: confidenceFor(signals),
      files: uniq([...named, ...dirFiles]),
      extras: {
        agentsMdWords: wordCount(m, 'AGENTS.md'),
      },
    };
  },
};

registerDetector(codexDetector);
