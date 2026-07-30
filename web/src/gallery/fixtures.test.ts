import { describe, expect, it } from 'vitest';
import { buildDemoDiff } from './fixtures.js';

describe('buildDemoDiff', () => {
  it('is multi-hunk with valid headers and non-empty hunks', () => {
    const hunks = buildDemoDiff();
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    for (const hunk of hunks) {
      expect(hunk.header).toMatch(/^@@ /);
      expect(hunk.lines.length).toBeGreaterThan(0);
    }
  });

  it('exercises add, del, and ctx line kinds', () => {
    const kinds = new Set(buildDemoDiff().flatMap((h) => h.lines.map((l) => l.kind)));
    expect(kinds).toEqual(new Set(['add', 'del', 'ctx']));
  });
});
