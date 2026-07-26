/**
 * Starter templates for the Skills & agents editor (bead agentconfig-wmc.4).
 * INERT DATA only — picking a template prefills the editor with a new file's
 * body and a suggested path; the actual create still goes through the guarded
 * useWriteFlow ({kind:'file'}) → diff → commit path. Nothing here writes.
 *
 * Each template's `defaultPath` is report-relative (the same shape the report
 * hands back for existing files). `<name>` is a placeholder the user renames in
 * the editor before saving.
 */

export type TemplateKind = 'skill' | 'agent';

export interface StarterTemplate {
  /** Stable id (used as the React key + selection value). */
  id: string;
  kind: TemplateKind;
  /** Short menu label. */
  label: string;
  /** One-line description of what the scaffold sets up. */
  summary: string;
  /** Suggested report-relative path for the new file (rename before saving). */
  defaultPath: string;
  /** The file body prefilled into the editor. */
  content: string;
}

const SKILL_MINIMAL = `---
name: my-skill
description: One line on when this skill should trigger and what it does.
---

# My skill

Explain the task this skill handles. Keep instructions concrete and ordered.

## Steps

1. First do this.
2. Then do that.
`;

const SKILL_WITH_TOOLS = `---
name: repo-search
description: Use when the user asks to find code, symbols, or usages in the repo.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Repo search

Locate code across the codebase and report exact file paths.

## Steps

1. Grep for the symbol or string.
2. Read the top matches to confirm.
3. Report absolute paths and a one-line summary.
`;

const AGENT_MINIMAL = `---
name: helper
description: A focused subagent. Describe when the orchestrator should delegate to it.
model: sonnet
tools:
  - Read
  - Grep
---

You are a focused subagent. State your single responsibility here, then the
steps you follow and the shape of the result you return.
`;

const AGENT_REVIEWER = `---
name: code-reviewer
description: Reviews a diff for correctness, security, and style. Delegate after edits.
model: sonnet
tools:
  - Read
  - Grep
  - Bash
---

You are a code reviewer. Given a change, review it for:

- Correctness and edge cases
- Security issues (injection, secrets, unsafe input)
- Style consistency with the surrounding code

Return findings as a terse, prioritized list with file:line references.
`;

/** All starter templates, in menu order (skills first, then agents). */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'skill-minimal',
    kind: 'skill',
    label: 'Minimal skill',
    summary: 'A bare SKILL.md with name, description, and a steps outline.',
    defaultPath: '.claude/skills/my-skill/SKILL.md',
    content: SKILL_MINIMAL,
  },
  {
    id: 'skill-tools',
    kind: 'skill',
    label: 'Skill with tools',
    summary: 'A SKILL.md scoped to a set of allowed tools.',
    defaultPath: '.claude/skills/repo-search/SKILL.md',
    content: SKILL_WITH_TOOLS,
  },
  {
    id: 'agent-minimal',
    kind: 'agent',
    label: 'Minimal subagent',
    summary: 'An agent .md with model, tools, and a role prompt.',
    defaultPath: '.claude/agents/helper.md',
    content: AGENT_MINIMAL,
  },
  {
    id: 'agent-reviewer',
    kind: 'agent',
    label: 'Code reviewer agent',
    summary: 'A review-focused subagent scaffold.',
    defaultPath: '.claude/agents/code-reviewer.md',
    content: AGENT_REVIEWER,
  },
];
