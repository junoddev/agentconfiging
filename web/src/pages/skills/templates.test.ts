import { describe, expect, it } from 'vitest';
import { classifyFile, toCard } from './logic.js';
import { parseFrontmatter, splitFrontmatter } from './frontmatter.js';
import { STARTER_TEMPLATES } from './templates.js';

describe('STARTER_TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes at least one skill and one agent', () => {
    expect(STARTER_TEMPLATES.some((t) => t.kind === 'skill')).toBe(true);
    expect(STARTER_TEMPLATES.some((t) => t.kind === 'agent')).toBe(true);
  });

  for (const t of STARTER_TEMPLATES) {
    describe(t.id, () => {
      it('has a default path matching its kind', () => {
        const entry = classifyFile(t.defaultPath);
        expect(entry?.kind).toBe(t.kind);
      });

      it('has parseable frontmatter with name + description', () => {
        const { frontmatter } = splitFrontmatter(t.content);
        expect(frontmatter).not.toBeNull();
        const card = toCard(parseFrontmatter(frontmatter as string), 'x');
        expect(card.name.trim()).not.toBe('');
        expect(card.description.trim()).not.toBe('');
      });

      it('carries no redaction marks (inert scaffold)', () => {
        expect(t.content).not.toContain('[REDACTED');
      });
    });
  }
});
