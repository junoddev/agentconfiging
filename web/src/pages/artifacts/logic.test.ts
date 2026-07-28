import { describe, expect, it } from 'vitest';
import type { DetectedAgent, GlobalEntry } from '../../api/types.js';
import { globalFileGroups } from './logic.js';

function agent(over: Partial<DetectedAgent> = {}): DetectedAgent {
  return { kind: 'claude-code', confidence: 'high', files: [], extras: {}, ...over };
}

function globalEntry(over: Partial<GlobalEntry> = {}): GlobalEntry {
  return {
    root: '/Users/x/.claude',
    dir: '.claude',
    agents: [],
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
    ...over,
  };
}

describe('globalFileGroups', () => {
  it('unions each entry’s agent files, de-duplicated, sorted, with absolute paths', () => {
    const groups = globalFileGroups([
      globalEntry({
        agents: [
          agent({ files: ['settings.json', 'CLAUDE.md'] }),
          agent({ kind: 'codex', files: ['CLAUDE.md', 'agents/reviewer.md'] }),
        ],
      }),
    ]);
    expect(groups).toEqual([
      {
        root: '/Users/x/.claude',
        files: [
          { rel: 'agents/reviewer.md', abs: '/Users/x/.claude/agents/reviewer.md' },
          { rel: 'CLAUDE.md', abs: '/Users/x/.claude/CLAUDE.md' },
          { rel: 'settings.json', abs: '/Users/x/.claude/settings.json' },
        ],
      },
    ]);
  });

  it('keeps one group per entry, in entry order, and skips file-less entries', () => {
    const groups = globalFileGroups([
      globalEntry({ root: '/u/.claude', agents: [agent({ files: ['CLAUDE.md'] })] }),
      globalEntry({ root: '/u/.cursor', dir: '.cursor' }),
      globalEntry({
        root: '/u/.codex',
        dir: '.codex',
        agents: [agent({ kind: 'codex', files: ['config.toml'] })],
      }),
    ]);
    expect(groups.map((g) => g.root)).toEqual(['/u/.claude', '/u/.codex']);
  });

  it('normalizes a trailing-slash root when joining absolute paths', () => {
    const groups = globalFileGroups([
      globalEntry({ root: '/u/.claude/', agents: [agent({ files: ['CLAUDE.md'] })] }),
    ]);
    expect(groups[0]?.files[0]?.abs).toBe('/u/.claude/CLAUDE.md');
  });

  it('is empty for no entries — the artifacts page renders unchanged', () => {
    expect(globalFileGroups([])).toEqual([]);
  });
});
