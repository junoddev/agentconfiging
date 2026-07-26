import { describe, expect, it } from 'vitest';
import { parseDiff } from './parseDiff.js';

describe('parseDiff', () => {
  it('parses a create-file diff (--- /dev/null), dropping file headers', () => {
    const text = '--- /dev/null\n+++ b/.gitignore\n@@ -0,0 +1,1 @@\n+.claude/settings.local.json\n';
    const hunks = parseDiff(text);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe('@@ -0,0 +1,1 @@');
    expect(hunks[0]!.lines).toEqual([{ kind: 'add', text: '.claude/settings.local.json' }]);
  });

  it('classifies add / del / context lines and strips the marker column', () => {
    const text =
      '--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1,3 +1,3 @@\n line one\n-line two\n+CHANGED\n line three\n';
    const [hunk] = parseDiff(text);
    expect(hunk!.lines).toEqual([
      { kind: 'ctx', text: 'line one' },
      { kind: 'del', text: 'line two' },
      { kind: 'add', text: 'CHANGED' },
      { kind: 'ctx', text: 'line three' },
    ]);
  });

  it('keeps a genuine blank CONTEXT line but drops the trailing newline artifact', () => {
    // A blank context line arrives as ' ' (space + empty); the final '' from the
    // trailing newline must NOT become a spurious context line.
    const text = '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n \n+added\n';
    const [hunk] = parseDiff(text);
    expect(hunk!.lines).toEqual([
      { kind: 'ctx', text: '' },
      { kind: 'add', text: 'added' },
    ]);
  });

  it('returns [] for empty diff text (no changes)', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('splits multiple hunks', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,1 @@\n-c\n+d\n';
    const hunks = parseDiff(text);
    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.header).toBe('@@ -10,1 +10,1 @@');
    expect(hunks[1]!.lines).toEqual([
      { kind: 'del', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
});
