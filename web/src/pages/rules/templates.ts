/**
 * Starter templates for the Rules editor (bead agentconfig-wmc.6). INERT DATA
 * only — picking a template prefills the editor with a new rule's body and a
 * suggested path; the actual create still goes through the guarded useWriteFlow
 * ({kind:'file'}) → diff → commit path. Nothing here writes.
 *
 * The set spans BOTH surfaces the editor unifies: a plain `.claude/rules/*.md`
 * (no frontmatter, always in context), a path-scoped Cursor `.mdc` (globs), and
 * an always-apply Cursor `.mdc`. `<name>` placeholders are renamed in the editor
 * before saving; each `defaultPath` is report-relative.
 */

export interface StarterTemplate {
  /** Stable id (React key + selection value). */
  id: string;
  source: 'claude' | 'cursor';
  /** Short menu label. */
  label: string;
  /** One-line description of what the scaffold sets up. */
  summary: string;
  /** Suggested report-relative path for the new file (rename before saving). */
  defaultPath: string;
  /** The file body prefilled into the editor. */
  content: string;
}

const CLAUDE_RULE = `# Testing rules

- Unit tests colocate with the code they cover as \`*.test.ts\`.
- Every bug fix lands with a regression test that fails before the fix.
- No snapshot tests — assert on concrete values.
`;

const CURSOR_SCOPED = `---
description: One line on when this rule applies and what it enforces.
globs: src/**/*.ts,src/**/*.tsx
alwaysApply: false
---

# Rule title

- State each convention as a concrete, checkable instruction.
- Keep the list short — one idea per bullet.
`;

const CURSOR_ALWAYS = `---
description: Project-wide conventions that always apply.
alwaysApply: true
---

# Project rules

- Prefer clarity over cleverness; name things for what they are.
- No commented-out code on the main branch.
`;

/** All starter templates, in menu order. */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'claude-rule',
    source: 'claude',
    label: 'Claude rule',
    summary: 'A plain .claude/rules markdown rule — always in context, no path filter.',
    defaultPath: '.claude/rules/testing.md',
    content: CLAUDE_RULE,
  },
  {
    id: 'cursor-scoped',
    source: 'cursor',
    label: 'Cursor rule (path-scoped)',
    summary: 'A .cursor/rules .mdc scoped to file globs shown as path-filter badges.',
    defaultPath: '.cursor/rules/typescript.mdc',
    content: CURSOR_SCOPED,
  },
  {
    id: 'cursor-always',
    source: 'cursor',
    label: 'Cursor rule (always apply)',
    summary: 'A .cursor/rules .mdc with alwaysApply and no path filter.',
    defaultPath: '.cursor/rules/project.mdc',
    content: CURSOR_ALWAYS,
  },
];
