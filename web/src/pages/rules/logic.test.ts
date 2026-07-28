import { describe, expect, it } from 'vitest';
import type { DetectedAgent, Report } from '../../api/types.js';
import {
  classifyGlobalRule,
  classifyRule,
  collectGlobalRules,
  collectRules,
  groupGlobalRulesByRoot,
  hasRedactionMarks,
  isRedacted,
  joinGlobalPath,
  parseBool,
  parseGlobs,
  parseRule,
  splitGlobScalar,
  tokenizeMarkdown,
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

describe('classifyRule', () => {
  it('classifies a .claude/rules markdown file', () => {
    expect(classifyRule('.claude/rules/style.md')).toEqual({
      source: 'claude',
      name: 'style',
      path: '.claude/rules/style.md',
    });
  });

  it('classifies a .cursor/rules .mdc file', () => {
    expect(classifyRule('.cursor/rules/typescript.mdc')).toEqual({
      source: 'cursor',
      name: 'typescript',
      path: '.cursor/rules/typescript.mdc',
    });
  });

  it('matches nested and backslash paths', () => {
    expect(classifyRule('sub/.claude/rules/x.md')?.source).toBe('claude');
    expect(classifyRule('.cursor\\rules\\y.mdc')?.source).toBe('cursor');
  });

  it('returns null for non-rule files', () => {
    expect(classifyRule('.claude/skills/deploy/SKILL.md')).toBeNull();
    expect(classifyRule('.cursor/rules/notes.txt')).toBeNull();
    expect(classifyRule('.claude/rules/nested/deep.md')).toBeNull();
    expect(classifyRule('README.md')).toBeNull();
  });
});

describe('collectRules', () => {
  it('unifies both runtimes, de-dupes, and sorts (source, name, path)', () => {
    const r = report([
      { files: ['.cursor/rules/typescript.mdc', '.claude/rules/style.md', 'README.md'] },
      { files: ['.claude/rules/style.md', '.claude/rules/testing.md', '.cursor/rules/api.mdc'] },
    ]);
    expect(collectRules(r)).toEqual([
      { source: 'claude', name: 'style', path: '.claude/rules/style.md' },
      { source: 'claude', name: 'testing', path: '.claude/rules/testing.md' },
      { source: 'cursor', name: 'api', path: '.cursor/rules/api.mdc' },
      { source: 'cursor', name: 'typescript', path: '.cursor/rules/typescript.mdc' },
    ]);
  });

  it('returns empty for an undefined report', () => {
    expect(collectRules(undefined)).toEqual([]);
  });
});

describe('joinGlobalPath', () => {
  it('joins a root and a root-relative path, normalizing stray slashes', () => {
    expect(joinGlobalPath('/Users/x/.claude', 'rules/style.md')).toBe(
      '/Users/x/.claude/rules/style.md',
    );
    expect(joinGlobalPath('/Users/x/.cursor/', '/rules/ts.mdc')).toBe(
      '/Users/x/.cursor/rules/ts.mdc',
    );
  });
});

describe('classifyGlobalRule', () => {
  it('matches .claude rules/*.md and .cursor rules/*.mdc (root-relative)', () => {
    expect(classifyGlobalRule('.claude', 'rules/style.md')).toEqual({
      source: 'claude',
      name: 'style',
    });
    expect(classifyGlobalRule('.cursor', 'rules/ts.mdc')).toEqual({
      source: 'cursor',
      name: 'ts',
    });
  });

  it('rejects wrong extensions, other dirs, and non-rule paths', () => {
    expect(classifyGlobalRule('.claude', 'rules/ts.mdc')).toBeNull();
    expect(classifyGlobalRule('.cursor', 'rules/style.md')).toBeNull();
    expect(classifyGlobalRule('.codex', 'rules/style.md')).toBeNull();
    expect(classifyGlobalRule('.claude', 'CLAUDE.md')).toBeNull();
  });
});

describe('collectGlobalRules / groupGlobalRulesByRoot', () => {
  const entries = [
    {
      root: '/u/.claude',
      dir: '.claude',
      agents: [{ files: ['rules/style.md', 'CLAUDE.md'] }, { files: ['rules/style.md'] }],
    },
    { root: '/u/.cursor', dir: '.cursor', agents: [{ files: ['rules/ts.mdc'] }] },
  ];

  it('joins absolute paths, de-dupes, and sorts (source, name, path)', () => {
    expect(collectGlobalRules(entries)).toEqual([
      { source: 'claude', name: 'style', path: '/u/.claude/rules/style.md', root: '/u/.claude' },
      { source: 'cursor', name: 'ts', path: '/u/.cursor/rules/ts.mdc', root: '/u/.cursor' },
    ]);
  });

  it('groups per root and emits nothing for empty input (page no-op)', () => {
    const groups = groupGlobalRulesByRoot(collectGlobalRules(entries));
    expect(groups.map((g) => g.root)).toEqual(['/u/.claude', '/u/.cursor']);
    expect(groups[0]?.rules.map((r) => r.name)).toEqual(['style']);
    expect(collectGlobalRules([])).toEqual([]);
    expect(groupGlobalRulesByRoot([])).toEqual([]);
  });
});

describe('splitGlobScalar', () => {
  it('splits Cursor bare comma-separated globs', () => {
    expect(splitGlobScalar('*.tsx,src/components/**')).toEqual(['*.tsx', 'src/components/**']);
  });

  it('keeps a brace-expansion glob intact (comma inside braces)', () => {
    expect(splitGlobScalar('*.{ts,tsx},src/**')).toEqual(['*.{ts,tsx}', 'src/**']);
  });

  it('unquotes and drops empties', () => {
    expect(splitGlobScalar('"src/**/*.ts", , *.md')).toEqual(['src/**/*.ts', '*.md']);
  });
});

describe('parseGlobs', () => {
  it('handles a bare comma-separated scalar', () => {
    expect(parseGlobs('*.tsx,src/components/**')).toEqual(['*.tsx', 'src/components/**']);
  });

  it('handles a YAML block/inline list (already split)', () => {
    expect(parseGlobs(['src/**/*.ts', 'src/**/*.tsx'])).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
  });

  it('is brace-safe across list items', () => {
    expect(parseGlobs(['*.{ts,tsx}'])).toEqual(['*.{ts,tsx}']);
  });

  it('degrades undefined/empty to []', () => {
    expect(parseGlobs(undefined)).toEqual([]);
    expect(parseGlobs('')).toEqual([]);
    expect(parseGlobs([])).toEqual([]);
  });
});

describe('parseBool', () => {
  it('reads truthy tokens', () => {
    expect(parseBool('true')).toBe(true);
    expect(parseBool('True')).toBe(true);
    expect(parseBool('false')).toBe(false);
    expect(parseBool(undefined)).toBe(false);
  });
});

describe('parseRule', () => {
  it('parses a Cursor .mdc with bare-comma globs', () => {
    const content = [
      '---',
      'description: React component conventions',
      'globs: *.tsx,src/components/**',
      'alwaysApply: false',
      '---',
      '',
      '# Component rules',
      '',
      '- One component per file.',
    ].join('\n');
    const p = parseRule(content);
    expect(p.hasFrontmatter).toBe(true);
    expect(p.description).toBe('React component conventions');
    expect(p.pathFilters).toEqual(['*.tsx', 'src/components/**']);
    expect(p.alwaysApply).toBe(false);
    expect(p.body).toContain('# Component rules');
  });

  it('parses a Cursor .mdc with a YAML block-list globs', () => {
    const content = [
      '---',
      'description: TypeScript conventions',
      'globs:',
      '  - "src/**/*.ts"',
      '  - "src/**/*.tsx"',
      'alwaysApply: false',
      '---',
      '',
      '# TS',
    ].join('\n');
    const p = parseRule(content);
    expect(p.pathFilters).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(p.description).toBe('TypeScript conventions');
  });

  it('parses an always-apply .mdc with no globs', () => {
    const content = ['---', 'description: API rules', 'alwaysApply: true', '---', '', 'body'].join(
      '\n',
    );
    const p = parseRule(content);
    expect(p.pathFilters).toEqual([]);
    expect(p.alwaysApply).toBe(true);
  });

  it('treats a plain .claude/rules markdown file (no frontmatter) as all body', () => {
    const content = '# Style rules\n\n- Prettier is the formatter.';
    const p = parseRule(content);
    expect(p.hasFrontmatter).toBe(false);
    expect(p.pathFilters).toEqual([]);
    expect(p.description).toBe('');
    expect(p.body).toBe(content);
  });

  it('is resilient to malformed frontmatter (unterminated fence → body)', () => {
    const content = '---\ndescription: broken\n\n# no closing fence';
    const p = parseRule(content);
    expect(p.hasFrontmatter).toBe(false);
    expect(p.body).toBe(content);
  });
});

describe('redaction guard (spans OR marks — belt-and-braces)', () => {
  it('detects a [REDACTED:*] mark in text', () => {
    expect(hasRedactionMarks('token = [REDACTED:github]')).toBe(true);
    expect(hasRedactionMarks('no secrets here')).toBe(false);
  });

  it('isRedacted fires on spans alone', () => {
    expect(isRedacted([{ start: 0, end: 1, id: 'x' }], 'clean text')).toBe(true);
  });

  it('isRedacted fires on a mark even with zero spans', () => {
    expect(isRedacted([], 'key: [REDACTED:aws]')).toBe(true);
  });

  it('isRedacted is false when neither signal is present', () => {
    expect(isRedacted([], 'ordinary rule content')).toBe(false);
  });
});

describe('tokenizeMarkdown', () => {
  it('produces heading, list, and code blocks over text only', () => {
    const blocks = tokenizeMarkdown('# Title\n\n- a\n- b\n\n```\ncode\n```');
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Title' });
    expect(blocks[1]).toEqual({ kind: 'list', ordered: false, items: ['a', 'b'] });
    expect(blocks[2]).toEqual({ kind: 'code', text: 'code' });
  });

  it('captures adversarial html verbatim as text (no markup interpretation)', () => {
    const blocks = tokenizeMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([{ kind: 'para', text: '<script>alert(1)</script>' }]);
  });
});
