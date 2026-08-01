import { describe, expect, it } from 'vitest';
import { joinGlobalPath } from './paths.js';

describe('joinGlobalPath', () => {
  it('joins a root and a root-relative path into one absolute path', () => {
    expect(joinGlobalPath('/Users/x/.claude', 'rules/a.md')).toBe('/Users/x/.claude/rules/a.md');
  });

  it('normalizes stray slashes on either side of the join', () => {
    expect(joinGlobalPath('/Users/x/.claude/', '/rules/a.md')).toBe('/Users/x/.claude/rules/a.md');
    expect(joinGlobalPath('/root///', '///rel')).toBe('/root/rel');
  });

  it('leaves an already-clean join untouched', () => {
    expect(joinGlobalPath('/root', 'a/b/c.md')).toBe('/root/a/b/c.md');
  });
});
