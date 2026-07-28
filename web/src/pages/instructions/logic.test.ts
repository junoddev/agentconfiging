import { describe, expect, it } from 'vitest';
import {
  collectGlobalInstructionFiles,
  collectInstructionFiles,
  extractImports,
  groupByScope,
  groupGlobalByRoot,
  hasRedactionMarks,
  isInstructionFile,
  joinGlobalPath,
  resolveImport,
  resolveImports,
  scopeOf,
  tokenizeMarkdown,
} from './logic.js';

describe('isInstructionFile', () => {
  it('accepts every runtime instruction basename at any depth', () => {
    for (const p of [
      'CLAUDE.md',
      'CLAUDE.local.md',
      'AGENTS.md',
      'GEMINI.md',
      '.cursorrules',
      '.claude/CLAUDE.md',
      'packages/app/AGENTS.md',
    ]) {
      expect(isInstructionFile(p)).toBe(true);
    }
  });

  it('rejects non-instruction and look-alike files', () => {
    for (const p of ['README.md', '.claude/settings.json', 'CLAUDE.md.bak', 'docs/GEMINI.mdx']) {
      expect(isInstructionFile(p)).toBe(false);
    }
  });
});

describe('scopeOf / groupByScope', () => {
  it('classifies .claude/ files vs project-root files', () => {
    expect(scopeOf('CLAUDE.md')).toBe('project');
    expect(scopeOf('.claude/CLAUDE.md')).toBe('claude-dir');
    expect(scopeOf('packages/x/.claude/CLAUDE.md')).toBe('claude-dir');
  });

  it('groups in stable order and omits empty groups', () => {
    const groups = groupByScope(['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md']);
    expect(groups.map((g) => g.scope)).toEqual(['project', 'claude-dir']);
    expect(groups[0]?.files).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(groups[1]?.files).toEqual(['.claude/CLAUDE.md']);

    const only = groupByScope(['CLAUDE.md']);
    expect(only.map((g) => g.scope)).toEqual(['project']);
  });
});

describe('collectInstructionFiles', () => {
  it('de-dupes across agents, keeps instruction files only, sorts', () => {
    const files = collectInstructionFiles([
      { files: ['CLAUDE.md', '.claude/settings.json'] },
      { files: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] },
    ]);
    expect(files).toEqual(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  });

  it('returns [] when no agents reference instruction files', () => {
    expect(collectInstructionFiles([{ files: ['package.json'] }])).toEqual([]);
    expect(collectInstructionFiles([])).toEqual([]);
  });
});

describe('joinGlobalPath', () => {
  it('joins a root and a root-relative path into one absolute path', () => {
    expect(joinGlobalPath('/Users/x/.claude', 'CLAUDE.md')).toBe('/Users/x/.claude/CLAUDE.md');
  });

  it('normalizes stray slashes on either side of the join', () => {
    expect(joinGlobalPath('/Users/x/.claude/', '/CLAUDE.md')).toBe('/Users/x/.claude/CLAUDE.md');
  });
});

describe('collectGlobalInstructionFiles', () => {
  it('joins each root, applies the instruction-basename filter, de-dupes, sorts', () => {
    const files = collectGlobalInstructionFiles([
      {
        root: '/Users/x/.claude',
        agents: [{ files: ['CLAUDE.md', 'settings.json'] }, { files: ['CLAUDE.md'] }],
      },
      { root: '/Users/x/.codex', agents: [{ files: ['AGENTS.md'] }] },
    ]);
    expect(files).toEqual([
      { path: '/Users/x/.claude/CLAUDE.md', rel: 'CLAUDE.md', root: '/Users/x/.claude' },
      { path: '/Users/x/.codex/AGENTS.md', rel: 'AGENTS.md', root: '/Users/x/.codex' },
    ]);
  });

  it('returns [] with no global entries or no instruction files (page no-op)', () => {
    expect(collectGlobalInstructionFiles([])).toEqual([]);
    expect(
      collectGlobalInstructionFiles([{ root: '/u/.claude', agents: [{ files: ['x.json'] }] }]),
    ).toEqual([]);
  });
});

describe('groupGlobalByRoot', () => {
  it('groups files per root and never emits an empty group', () => {
    const claude = { path: '/u/.claude/CLAUDE.md', rel: 'CLAUDE.md', root: '/u/.claude' };
    const codex = { path: '/u/.codex/AGENTS.md', rel: 'AGENTS.md', root: '/u/.codex' };
    const groups = groupGlobalByRoot([claude, codex]);
    expect(groups).toEqual([
      { root: '/u/.claude', files: [claude] },
      { root: '/u/.codex', files: [codex] },
    ]);
    expect(groupGlobalByRoot([])).toEqual([]);
  });
});

describe('extractImports', () => {
  it('finds @imports at line start and after whitespace', () => {
    const refs = extractImports('@./RTK.md\nsee also @docs/rules.md for more');
    expect(refs).toEqual([
      { target: './RTK.md', line: 1 },
      { target: 'docs/rules.md', line: 2 },
    ]);
  });

  it('ignores email addresses (the @ is inside a word)', () => {
    expect(extractImports('contact aaron@example.com anytime')).toEqual([]);
  });

  it('ignores @imports inside fenced code blocks', () => {
    const content = ['before @real.md', '```', 'not @fake.md', '```', 'after @also.md'].join('\n');
    expect(extractImports(content).map((r) => r.target)).toEqual(['real.md', 'also.md']);
  });

  it('ignores @imports inside inline code spans', () => {
    expect(extractImports('use `@ignored.md` but load @kept.md')).toEqual([
      { target: 'kept.md', line: 1 },
    ]);
  });

  it('trims trailing sentence punctuation and de-dupes by target', () => {
    const refs = extractImports('load @config/rules.md.\nagain @config/rules.md');
    expect(refs).toEqual([{ target: 'config/rules.md', line: 1 }]);
  });

  it('handles home- and absolute-anchored targets', () => {
    expect(extractImports('@~/.claude/CLAUDE.md and @/etc/agents.md').map((r) => r.target)).toEqual(
      ['~/.claude/CLAUDE.md', '/etc/agents.md'],
    );
  });
});

describe('resolveImport', () => {
  it('resolves relative to the importing file directory', () => {
    expect(resolveImport('rules.md', '.claude/CLAUDE.md')).toBe('.claude/rules.md');
    expect(resolveImport('./rules.md', 'CLAUDE.md')).toBe('rules.md');
    expect(resolveImport('../shared/x.md', 'a/b/CLAUDE.md')).toBe('a/shared/x.md');
  });

  it('returns undefined for absolute or home paths', () => {
    expect(resolveImport('/etc/x.md', 'CLAUDE.md')).toBeUndefined();
    expect(resolveImport('~/x.md', 'CLAUDE.md')).toBeUndefined();
  });
});

describe('resolveImports', () => {
  const known = new Set(['docs/rules.md', 'CLAUDE.md']);

  it('classifies present, missing, and external imports', () => {
    const refs = [
      { target: './docs/rules.md', line: 1 },
      { target: './docs/gone.md', line: 2 },
      { target: '~/.claude/CLAUDE.md', line: 3 },
    ];
    const resolved = resolveImports(refs, 'CLAUDE.md', known);
    expect(resolved.map((r) => r.status)).toEqual(['present', 'missing', 'external']);
    expect(resolved[0]?.resolved).toBe('docs/rules.md');
    expect(resolved[2]?.resolved).toBeUndefined();
  });
});

describe('hasRedactionMarks', () => {
  it('detects [REDACTED:*] placeholder marks', () => {
    expect(hasRedactionMarks('token = [REDACTED:openai]')).toBe(true);
    expect(hasRedactionMarks('nothing secret here')).toBe(false);
    expect(hasRedactionMarks('an array literal [0] is not a mark')).toBe(false);
  });
});

describe('tokenizeMarkdown', () => {
  it('splits headings, paragraphs, and grouped list items', () => {
    const blocks = tokenizeMarkdown('# Title\n\nsome text\n\n- a\n- b');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'para', text: 'some text' },
      { kind: 'list', ordered: false, items: ['a', 'b'] },
    ]);
  });

  it('captures fenced code verbatim without reading structure inside it', () => {
    const blocks = tokenizeMarkdown('```\n# not a heading\n@not-an-import\n```');
    expect(blocks).toEqual([{ kind: 'code', text: '# not a heading\n@not-an-import' }]);
  });

  it('flushes an unterminated fence at end of input', () => {
    const blocks = tokenizeMarkdown('```\nline one\nline two');
    expect(blocks).toEqual([{ kind: 'code', text: 'line one\nline two' }]);
  });

  it('separates ordered from unordered lists and reads blockquotes', () => {
    const blocks = tokenizeMarkdown('> note\n\n1. one\n2. two');
    expect(blocks).toEqual([
      { kind: 'quote', text: 'note' },
      { kind: 'list', ordered: true, items: ['one', 'two'] },
    ]);
  });

  it('detects heading level from the number of #', () => {
    expect(tokenizeMarkdown('### Deep')).toEqual([{ kind: 'heading', level: 3, text: 'Deep' }]);
  });
});
