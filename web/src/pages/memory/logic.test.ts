import { describe, expect, it } from 'vitest';
import type { DetectedAgent, FileContent, Report } from '../../api/types.js';
import {
  bodyPreview,
  buildCard,
  collectGlobalMemoryFiles,
  collectMemoryFiles,
  hasRedactionMarks,
  isMemoryFile,
  isRedacted,
  joinGlobalPath,
  memoryName,
  parseMemory,
  serializeMemory,
  slugify,
  suggestPath,
  type MemoryFields,
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

const file = (content: string, spans: FileContent['spans'] = []): FileContent => ({
  path: 'p',
  content,
  spans,
  pathScope: 'project',
});

describe('isMemoryFile', () => {
  it('matches .md files inside a memory/ directory', () => {
    expect(isMemoryFile('.claude/memory/context.md')).toBe(true);
    expect(isMemoryFile('/home/u/.claude/projects/slug/memory/decisions.md')).toBe(true);
    expect(isMemoryFile('.claude\\memory\\notes.md')).toBe(true);
  });

  it('rejects non-memory or non-md paths', () => {
    expect(isMemoryFile('.claude/skills/deploy/SKILL.md')).toBe(false);
    expect(isMemoryFile('.claude/memory/notes/deep.md')).toBe(false);
    expect(isMemoryFile('.claude/memory/data.json')).toBe(false);
    expect(isMemoryFile('memoryfoo/x.md')).toBe(false);
  });
});

describe('memoryName', () => {
  it('is the basename without the .md suffix', () => {
    expect(memoryName('.claude/memory/context.md')).toBe('context');
  });
});

describe('collectMemoryFiles', () => {
  it('collects, de-duplicates, and sorts memory paths', () => {
    const r = report([
      { files: ['.claude/memory/z.md', 'README.md', '.claude/memory/a.md'] },
      { files: ['.claude/memory/z.md', '.claude/skills/x/SKILL.md'] },
    ]);
    expect(collectMemoryFiles(r)).toEqual(['.claude/memory/a.md', '.claude/memory/z.md']);
  });

  it('returns empty for an undefined report', () => {
    expect(collectMemoryFiles(undefined)).toEqual([]);
  });
});

describe('joinGlobalPath', () => {
  it('joins a root and a root-relative path, normalizing stray slashes', () => {
    expect(joinGlobalPath('/Users/x/.claude', 'memory/a.md')).toBe('/Users/x/.claude/memory/a.md');
    expect(joinGlobalPath('/Users/x/.claude/', '/memory/a.md')).toBe(
      '/Users/x/.claude/memory/a.md',
    );
  });
});

describe('collectGlobalMemoryFiles', () => {
  it('applies the memory filter, joins absolute paths, de-dupes, and sorts', () => {
    const files = collectGlobalMemoryFiles([
      {
        root: '/u/.claude',
        agents: [
          { files: ['memory/z.md', 'CLAUDE.md'] },
          { files: ['memory/z.md', 'memory/a.md'] },
        ],
      },
    ]);
    expect(files).toEqual([
      { path: '/u/.claude/memory/a.md', root: '/u/.claude' },
      { path: '/u/.claude/memory/z.md', root: '/u/.claude' },
    ]);
  });

  it('returns [] with no global entries or no memory files (page no-op)', () => {
    expect(collectGlobalMemoryFiles([])).toEqual([]);
    expect(
      collectGlobalMemoryFiles([{ root: '/u/.codex', agents: [{ files: ['AGENTS.md'] }] }]),
    ).toEqual([]);
  });
});

describe('redaction detection (spans OR marks)', () => {
  it('flags on server spans', () => {
    expect(isRedacted(file('clean', [{ start: 0, end: 3, id: 'k' }]))).toBe(true);
  });

  it('flags on a [REDACTED:*] mark even with no spans', () => {
    expect(hasRedactionMarks('token is [REDACTED:api_key] here')).toBe(true);
    expect(isRedacted(file('token is [REDACTED:api_key]'))).toBe(true);
  });

  it('is false for clean content and no spans', () => {
    expect(isRedacted(file('nothing secret here'))).toBe(false);
  });
});

describe('parseMemory / serializeMemory round-trip', () => {
  const cases: Record<string, MemoryFields> = {
    typical: {
      type: 'context',
      name: 'fulfillment-partners',
      description: 'Quirks of the three fulfillment partner APIs',
      body: '# Partner API quirks\n\n- Partner A retries webhooks.',
      extra: [],
    },
    'colon in description': {
      type: 'user',
      name: 'ratios',
      description: 'contrast is 3:1 minimum',
      body: 'Body line.',
      extra: [],
    },
    'empty fields': { type: '', name: '', description: '', body: '', extra: [] },
    'preserves unmodeled keys': {
      type: 'project',
      name: 'n',
      description: 'd',
      body: 'b',
      extra: [
        { key: 'author', value: 'aaron' },
        { key: 'tags', value: 'infra, billing' },
      ],
    },
  };

  for (const [label, fields] of Object.entries(cases)) {
    it(`round-trips: ${label}`, () => {
      expect(parseMemory(serializeMemory(fields))).toEqual(fields);
    });
  }

  it('does not drop unknown frontmatter keys on a re-serialize', () => {
    const original = '---\ntype: user\nname: n\nauthor: aaron\ntags: a, b\n---\n\nbody\n';
    const reserialized = serializeMemory(parseMemory(original));
    expect(reserialized).toContain('author: aaron');
    expect(reserialized).toContain('tags: a, b');
  });

  it('parses the claude-rich fixture shape', () => {
    const content =
      '---\ntype: decision\nname: outbox\ndescription: why the outbox\n---\n\n# Decision\n\nDirect publishes lost events.';
    expect(parseMemory(content)).toEqual({
      type: 'decision',
      name: 'outbox',
      description: 'why the outbox',
      body: '# Decision\n\nDirect publishes lost events.',
      extra: [],
    });
  });

  it('degrades a file with no frontmatter to empty fields + full body', () => {
    expect(parseMemory('# Just prose\nno frontmatter')).toEqual({
      type: '',
      name: '',
      description: '',
      body: '# Just prose\nno frontmatter',
      extra: [],
    });
  });

  it('degrades a missing type/name to empty strings', () => {
    expect(parseMemory('---\ndescription: only desc\n---\nbody')).toEqual({
      type: '',
      name: '',
      description: 'only desc',
      body: 'body',
      extra: [],
    });
  });

  it('serializes an empty note without a trailing blank block', () => {
    expect(serializeMemory({ type: 'user', name: 'n', description: '', body: '', extra: [] })).toBe(
      '---\ntype: user\nname: n\ndescription: \n---\n',
    );
  });
});

describe('bodyPreview', () => {
  it('takes the first substantive line, skipping headings and fences', () => {
    expect(bodyPreview('# Title\n\n```\ncode\n```\nThe real fact here.')).toBe(
      'The real fact here.',
    );
  });

  it('truncates long lines with an ellipsis', () => {
    expect(bodyPreview('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('is empty when the body is only structure', () => {
    expect(bodyPreview('# Only a heading\n\n')).toBe('');
  });
});

describe('buildCard', () => {
  it('builds a card from frontmatter + body, name falling back to basename', () => {
    const card = buildCard(
      '.claude/memory/prefs.md',
      file('---\ntype: user\ndescription: my prefs\n---\n\nAlways use tabs.'),
    );
    expect(card).toEqual({
      path: '.claude/memory/prefs.md',
      name: 'prefs',
      type: 'user',
      description: 'my prefs',
      preview: 'Always use tabs.',
      redacted: false,
    });
  });

  it('marks a redacted file (via marks) and still yields a usable card', () => {
    const card = buildCard(
      '.claude/memory/secret.md',
      file('---\ntype: reference\nname: keys\n---\n\ntoken [REDACTED:api_key]'),
    );
    expect(card.redacted).toBe(true);
    expect(card.name).toBe('keys');
  });
});

describe('slugify / suggestPath', () => {
  it('slugifies a name to a filesystem-safe stem', () => {
    expect(slugify('My Prefs & Notes!')).toBe('my-prefs-notes');
    expect(slugify('')).toBe('note');
  });

  it('suggests a memory path from a name', () => {
    expect(suggestPath('Deploy Rules')).toBe('.claude/memory/deploy-rules.md');
  });
});
