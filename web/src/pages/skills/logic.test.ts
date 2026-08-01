import { describe, expect, it } from 'vitest';
import type { DetectedAgent, Report } from '../../api/types.js';
import { parseFrontmatter } from '../../lib/frontmatter.js';
import {
  classifyFile,
  collectEntries,
  collectGlobalEntries,
  deriveGraph,
  extractMcpServers,
  toCard,
  type SkillEntry,
} from './logic.js';

function report(agents: Partial<DetectedAgent>[]): Report {
  return {
    version: '1',
    generatedAt: 'now',
    root: '/p',
    scope: 'project',
    localOnly: false,
    agents: agents.map((a) => ({
      kind: 'claude-code',
      confidence: 'high',
      files: [],
      extras: {},
      ...a,
    })),
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
  };
}

describe('classifyFile', () => {
  it('classifies a SKILL.md as a skill named by its directory', () => {
    expect(classifyFile('.claude/skills/deploy/SKILL.md')).toEqual({
      kind: 'skill',
      name: 'deploy',
      path: '.claude/skills/deploy/SKILL.md',
    });
  });

  it('classifies an agent .md by its basename', () => {
    expect(classifyFile('.claude/agents/reviewer.md')).toEqual({
      kind: 'agent',
      name: 'reviewer',
      path: '.claude/agents/reviewer.md',
    });
  });

  it('normalizes backslash separators', () => {
    expect(classifyFile('.claude\\agents\\r.md')?.kind).toBe('agent');
  });

  it('returns null for unrelated files', () => {
    expect(classifyFile('.claude/settings.json')).toBeNull();
    expect(classifyFile('README.md')).toBeNull();
    expect(classifyFile('.claude/skills/deploy/other.md')).toBeNull();
  });
});

describe('collectEntries', () => {
  it('collects, de-duplicates, and sorts skill + agent files', () => {
    const r = report([
      { files: ['.claude/agents/zeta.md', '.claude/skills/deploy/SKILL.md', 'README.md'] },
      { files: ['.claude/agents/zeta.md', '.claude/agents/alpha.md'] },
    ]);
    expect(collectEntries(r)).toEqual([
      { kind: 'agent', name: 'alpha', path: '.claude/agents/alpha.md' },
      { kind: 'agent', name: 'zeta', path: '.claude/agents/zeta.md' },
      { kind: 'skill', name: 'deploy', path: '.claude/skills/deploy/SKILL.md' },
    ]);
  });

  it('returns empty for an undefined report', () => {
    expect(collectEntries(undefined)).toEqual([]);
  });
});

describe('collectGlobalEntries', () => {
  it('collects ~/.claude skills + agents as absolute paths, de-duped and sorted', () => {
    const entries = collectGlobalEntries([
      {
        root: '/Users/x/.claude',
        dir: '.claude',
        agents: [
          { files: ['skills/deploy/SKILL.md', 'agents/zeta.md', 'settings.json'] },
          { files: ['agents/zeta.md'] },
        ],
      },
    ]);
    expect(entries).toEqual([
      {
        kind: 'agent',
        name: 'zeta',
        path: '/Users/x/.claude/agents/zeta.md',
        root: '/Users/x/.claude',
      },
      {
        kind: 'skill',
        name: 'deploy',
        path: '/Users/x/.claude/skills/deploy/SKILL.md',
        root: '/Users/x/.claude',
      },
    ]);
  });

  it('ignores non-.claude global dirs and returns [] when nothing matches', () => {
    expect(
      collectGlobalEntries([
        { root: '/Users/x/.codex', dir: '.codex', agents: [{ files: ['agents/a.md'] }] },
      ]),
    ).toEqual([]);
    expect(collectGlobalEntries([])).toEqual([]);
  });
});

describe('extractMcpServers', () => {
  it('pulls the server name from mcp__server__tool tokens', () => {
    expect(extractMcpServers(['mcp__claude_ai_Figma__whoami', 'Read'])).toEqual([
      'claude_ai_Figma',
    ]);
  });
  it('ignores non-mcp tokens', () => {
    expect(extractMcpServers(['Bash', 'notmcp__x'])).toEqual([]);
  });
});

describe('toCard', () => {
  it('extracts the known fields and merges tools + allowed-tools', () => {
    const fm = parseFrontmatter(
      [
        'name: rev',
        'description: reviews code',
        'model: sonnet',
        'tools: [Read, Bash]',
        'allowed-tools:',
        '  - Grep',
      ].join('\n'),
    );
    const card = toCard(fm, 'fallback');
    expect(card.name).toBe('rev');
    expect(card.description).toBe('reviews code');
    expect(card.model).toBe('sonnet');
    expect(card.tools).toEqual(['Bash', 'Grep', 'Read']);
  });

  it('falls back to the entry name when frontmatter omits name', () => {
    expect(toCard(parseFrontmatter('model: opus'), 'from-file').name).toBe('from-file');
  });

  it('derives MCP servers from tool tokens', () => {
    const card = toCard(parseFrontmatter('tools: [mcp__notion__search, Read]'), 'x');
    expect(card.mcp).toEqual(['notion']);
  });

  it('routes unknown keys to other', () => {
    const card = toCard(parseFrontmatter('name: x\ncolor: blue'), 'x');
    expect(card.other.map((e) => e.key)).toEqual(['color']);
  });

  it('reads permissions and hooks as lists', () => {
    const card = toCard(parseFrontmatter('permissions:\n  - Bash\nhooks: [pre, post]'), 'x');
    expect(card.permissions).toEqual(['Bash']);
    expect(card.hooks).toEqual(['pre', 'post']);
  });
});

describe('deriveGraph', () => {
  function card(entry: SkillEntry, fm: string) {
    return { entry, card: toCard(parseFrontmatter(fm), entry.name) };
  }

  it('builds bipartite edges to tools and mcp servers', () => {
    const g = deriveGraph([
      card({ kind: 'agent', name: 'rev', path: 'a' }, 'tools: [Read, mcp__notion__q]'),
    ]);
    expect(g.sources.map((n) => n.id)).toEqual(['agent:rev']);
    expect(g.targets.map((n) => n.id)).toEqual(['mcp:notion', 'tool:Read']);
    expect(g.edges).toEqual([
      { from: 'agent:rev', to: 'mcp:notion' },
      { from: 'agent:rev', to: 'tool:Read' },
    ]);
  });

  it('adds a cross-reference edge when a card names another entry', () => {
    const g = deriveGraph([
      card({ kind: 'agent', name: 'lead', path: 'a' }, 'tools: [helper]'),
      card({ kind: 'agent', name: 'helper', path: 'b' }, 'tools: [Read]'),
    ]);
    // lead references helper by name → edge lead → helper (helper also a target)
    expect(g.edges).toContainEqual({ from: 'agent:lead', to: 'agent:helper' });
    expect(g.targets.some((n) => n.id === 'agent:helper')).toBe(true);
  });

  it('does not self-reference', () => {
    const g = deriveGraph([card({ kind: 'agent', name: 'solo', path: 'a' }, 'tools: [solo]')]);
    expect(g.edges).toEqual([{ from: 'agent:solo', to: 'tool:solo' }]);
  });

  it('is deterministic and de-duplicates shared targets', () => {
    const g = deriveGraph([
      card({ kind: 'agent', name: 'b', path: 'b' }, 'tools: [Read]'),
      card({ kind: 'skill', name: 'a', path: 'a' }, 'tools: [Read]'),
    ]);
    expect(g.targets).toEqual([{ id: 'tool:Read', kind: 'tool', label: 'Read' }]);
    expect(g.edges).toEqual([
      { from: 'agent:b', to: 'tool:Read' },
      { from: 'skill:a', to: 'tool:Read' },
    ]);
  });

  it('handles an empty card set', () => {
    expect(deriveGraph([])).toEqual({ sources: [], targets: [], edges: [] });
  });
});
