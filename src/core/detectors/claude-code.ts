/**
 * Claude Code detector — port of `detectors/claude_code.ex`.
 *
 * Signals (5, counted): CLAUDE.md, .claude/settings.json,
 * .claude/agents/*, .claude/skills/*, .claude/commands/*.
 * Confidence: >=3 high, >=2 medium, else low.
 *
 * Global scope: a manifest rooted at ~/.claude (cwdBasename '.claude')
 * carries the same layout without the '.claude/' prefix; `dirPrefix`
 * normalizes that.
 */

import type { Manifest } from '../manifest.js';
import { registerDetector } from './registry.js';
import { anyUnder, dirPrefix, filesUnder, findFile, hasDir, uniq, wordCount } from './shared.js';
import type { DetectedAgent, Detector } from './types.js';

const DIR = '.claude';

function confidenceFor(signals: number): DetectedAgent['confidence'] {
  if (signals >= 3) return 'high';
  if (signals >= 2) return 'medium';
  return 'low';
}

export const claudeCodeDetector: Detector = {
  id: 'claude-code',

  matches(m: Manifest): boolean {
    return hasDir(m, dirPrefix(m, DIR)) || findFile(m, 'CLAUDE.md') !== undefined;
  },

  extract(m: Manifest): DetectedAgent {
    const prefix = dirPrefix(m, DIR);
    const settingsPath = `${prefix}settings.json`;
    const localSettingsPath = `${prefix}settings.local.json`;

    const named = ['CLAUDE.md', '.mcp.json', settingsPath, localSettingsPath].filter((p) =>
      findFile(m, p),
    );
    const dirFiles = filesUnder(m, prefix).map((f) => f.path);

    const signals = [
      findFile(m, 'CLAUDE.md') !== undefined,
      findFile(m, settingsPath) !== undefined,
      anyUnder(m, `${prefix}agents/`),
      anyUnder(m, `${prefix}skills/`),
      anyUnder(m, `${prefix}commands/`),
    ].filter(Boolean).length;

    return {
      kind: 'claude-code',
      confidence: confidenceFor(signals),
      files: uniq([...named, ...dirFiles]),
      extras: {
        claudeMdWords: wordCount(m, 'CLAUDE.md'),
        hasSettings: findFile(m, settingsPath) !== undefined,
        hasLocalSettings: findFile(m, localSettingsPath) !== undefined,
        agentsCount: filesUnder(m, `${prefix}agents/`).length,
        skillsCount: filesUnder(m, `${prefix}skills/`).length,
      },
    };
  },
};

registerDetector(claudeCodeDetector);
