import { describe, expect, it } from 'vitest';
import { classifyRule, parseRule } from './logic.js';
import { STARTER_TEMPLATES } from './templates.js';

describe('STARTER_TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers both runtimes', () => {
    expect(STARTER_TEMPLATES.some((t) => t.source === 'claude')).toBe(true);
    expect(STARTER_TEMPLATES.some((t) => t.source === 'cursor')).toBe(true);
  });

  for (const t of STARTER_TEMPLATES) {
    describe(t.id, () => {
      it('has a default path that classifies to its source', () => {
        expect(classifyRule(t.defaultPath)?.source).toBe(t.source);
      });

      it('parses without error and carries a body', () => {
        const p = parseRule(t.content);
        expect(p.body.trim()).not.toBe('');
        // Cursor templates carry frontmatter; claude templates are plain md.
        expect(p.hasFrontmatter).toBe(t.source === 'cursor');
      });

      it('is an inert scaffold (no redaction marks)', () => {
        expect(t.content).not.toContain('[REDACTED');
      });
    });
  }

  it('the path-scoped cursor template yields path-filter badges', () => {
    const scoped = STARTER_TEMPLATES.find((t) => t.id === 'cursor-scoped');
    expect(scoped).toBeDefined();
    expect(parseRule(scoped!.content).pathFilters.length).toBeGreaterThan(0);
  });
});
