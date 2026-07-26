/**
 * Registry tests (agentconfig-0zm.1): the untrusted-input validator, the
 * checksum verifier, seed integrity (the key test — every seed entry must
 * verify), and the loader.
 */

import { describe, expect, it } from 'vitest';
import { parseRegistryIndex, RegistryIndexError, LIMITS as REGISTRY_LIMITS } from './validate.js';
import { sha256Hex, verifyEntry } from './verify.js';
import { loadSeed, loadSeedIndex } from './loader.js';
import type { RegistryEntry, RegistryIndex } from './schema.js';

/** A minimal well-formed entry with a correct checksum. */
function goodEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  const content = 'hello world\n';
  return {
    kind: 'skill',
    name: 'demo',
    description: 'a demo entry',
    version: '1.0.0',
    source: 'test',
    tags: ['template'],
    files: [{ path: '.claude/skills/demo/SKILL.md', content, sha256: sha256Hex(content) }],
    ...overrides,
  };
}

function goodIndex(entries: unknown[]): unknown {
  return { version: '1.0.0', entries };
}

describe('parseRegistryIndex — valid input', () => {
  it('accepts a well-formed index', () => {
    const result = parseRegistryIndex(goodIndex([goodEntry()]));
    expect(result.index.version).toBe('1.0.0');
    expect(result.index.entries).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('accepts a url-bearing file (deferred verification)', () => {
    const entry = goodEntry({
      files: [{ path: 'a.md', url: 'https://example.com/a.md', sha256: 'a'.repeat(64) }],
    });
    const result = parseRegistryIndex(goodIndex([entry]));
    expect(result.index.entries).toHaveLength(1);
    expect(result.index.entries[0]?.files[0]?.url).toBe('https://example.com/a.md');
  });
});

describe('parseRegistryIndex — top-level rejection', () => {
  it.each([
    ['non-object', 42],
    ['null', null],
    ['array', []],
    ['missing version', { entries: [] }],
    ['empty version', { version: '', entries: [] }],
    ['entries not array', { version: '1', entries: {} }],
  ])('throws RegistryIndexError for %s', (_label, input) => {
    expect(() => parseRegistryIndex(input)).toThrow(RegistryIndexError);
  });

  it('rejects an index with too many entries', () => {
    const entries = new Array(REGISTRY_LIMITS.maxEntries + 1).fill(goodEntry());
    expect(() => parseRegistryIndex(goodIndex(entries))).toThrow(RegistryIndexError);
  });
});

describe('parseRegistryIndex — per-entry skip (non-fatal)', () => {
  it('skips a malformed entry but keeps the good ones', () => {
    const result = parseRegistryIndex(goodIndex([goodEntry(), { kind: 'skill' }, goodEntry()]));
    expect(result.index.entries).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.entryIndex).toBe(1);
  });

  it.each([
    ['unknown kind', goodEntry({ kind: 'malware' as never })],
    ['missing name', { ...goodEntry(), name: undefined }],
    ['non-string description', { ...goodEntry(), description: 123 }],
    ['empty files', goodEntry({ files: [] })],
    [
      'both content and url',
      {
        ...goodEntry(),
        files: [{ path: 'a', content: 'x', url: 'https://e.com', sha256: 'a'.repeat(64) }],
      },
    ],
    ['neither content nor url', { ...goodEntry(), files: [{ path: 'a', sha256: 'a'.repeat(64) }] }],
    ['malformed sha256', { ...goodEntry(), files: [{ path: 'a', content: 'x', sha256: 'ZZZ' }] }],
    [
      'non-http url',
      {
        ...goodEntry(),
        files: [{ path: 'a', url: 'file:///etc/passwd', sha256: 'a'.repeat(64) }],
      },
    ],
    ['tags not array', { ...goodEntry(), tags: 'template' }],
  ])('skips entry: %s', (_label, entry) => {
    const result = parseRegistryIndex(goodIndex([entry]));
    expect(result.index.entries).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
  });
});

describe('parseRegistryIndex — hostile shapes', () => {
  it('is immune to __proto__ pollution via an entry', () => {
    const polluted = JSON.parse('{"version":"1","entries":[{"__proto__":{"polluted":true}}]}');
    parseRegistryIndex(polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not read inherited keys as fields', () => {
    const base = { name: 'inherited' };
    const entry = Object.create(base);
    // own props form an otherwise-valid entry, but name lives on the prototype
    Object.assign(entry, goodEntry());
    delete entry.name;
    const result = parseRegistryIndex(goodIndex([entry]));
    // name resolved only via prototype -> treated as missing -> skipped
    expect(result.index.entries).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
  });

  it('caps oversized content', () => {
    const huge = 'x'.repeat(REGISTRY_LIMITS.maxContent + 1);
    const entry = { ...goodEntry(), files: [{ path: 'a', content: huge, sha256: 'a'.repeat(64) }] };
    const result = parseRegistryIndex(goodIndex([entry]));
    expect(result.index.entries).toHaveLength(0);
  });

  it('caps an oversized description', () => {
    const entry = { ...goodEntry(), description: 'x'.repeat(REGISTRY_LIMITS.maxDescription + 1) };
    expect(parseRegistryIndex(goodIndex([entry])).index.entries).toHaveLength(0);
  });

  it('caps too many files in one entry', () => {
    const files = new Array(REGISTRY_LIMITS.maxFilesPerEntry + 1).fill({
      path: 'a',
      content: 'x',
      sha256: sha256Hex('x'),
    });
    expect(parseRegistryIndex(goodIndex([goodEntry({ files })])).index.entries).toHaveLength(0);
  });

  it('scrubs control characters out of issue reasons', () => {
    const entry = goodEntry({ kind: '\x1b[2Jevil\x00' as never });
    const reason = parseRegistryIndex(goodIndex([entry])).issues[0]?.reason ?? '';
    const hasControl = [...reason].some((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x20 || c === 0x7f;
    });
    expect(hasControl).toBe(false);
  });
});

describe('verifyEntry', () => {
  it('passes when every inlined sha256 matches', () => {
    expect(verifyEntry(goodEntry()).ok).toBe(true);
  });

  it('fails on a sha256 mismatch and names the file', () => {
    const entry = goodEntry({
      files: [{ path: 'a.md', content: 'tampered', sha256: 'a'.repeat(64) }],
    });
    const result = verifyEntry(entry);
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]?.path).toBe('a.md');
    expect(result.mismatches[0]?.reason).toBe('mismatch');
  });

  it('defers url-bearing files instead of failing', () => {
    const entry = goodEntry({
      files: [{ path: 'a.md', url: 'https://example.com/a', sha256: 'a'.repeat(64) }],
    });
    const result = verifyEntry(entry);
    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(1);
  });
});

describe('seed integrity', () => {
  const { index, issues } = loadSeed();

  it('loads with zero validation issues', () => {
    expect(issues).toEqual([]);
  });

  it('EVERY seed entry passes verifyEntry (the key integrity check)', () => {
    const failures = index.entries
      .filter((e) => !verifyEntry(e).ok)
      .map((e) => `${e.kind}/${e.name}`);
    expect(failures).toEqual([]);
  });

  it('ships at least 30 template-tagged entries', () => {
    const templates = index.entries.filter((e) => e.tags.includes('template'));
    expect(templates.length).toBeGreaterThanOrEqual(30);
  });

  it('includes runtime-template entries for cursor, codex, and gemini', () => {
    const runtimes = index.entries.filter((e) => e.kind === 'runtime-template');
    expect(runtimes.length).toBeGreaterThanOrEqual(3);
    const names = runtimes.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(['cursor-starter', 'codex-starter', 'gemini-starter']),
    );
  });

  it('covers every artifact kind across the gallery', () => {
    const kinds = new Set(index.entries.map((e) => e.kind));
    for (const k of ['skill', 'subagent', 'rule', 'hook', 'mcp-server', 'command']) {
      expect(kinds.has(k as RegistryEntry['kind'])).toBe(true);
    }
  });

  it('has a unique (kind, name) key for every entry', () => {
    const keys = index.entries.map((e) => `${e.kind}/${e.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('loadSeedIndex', () => {
  it('returns the validated index directly', () => {
    const index: RegistryIndex = loadSeedIndex();
    expect(index.version).toBe('1.0.0');
    expect(index.entries.length).toBeGreaterThanOrEqual(33);
  });
});
