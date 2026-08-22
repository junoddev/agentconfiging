export type AgentChangeStatus = 'observed' | 'promoted';

export interface AgentChange {
  id: string;
  observedAt: string;
  agentId: string;
  agentName: string;
  title: string;
  summary: string;
  before: string;
  after: string;
  status: AgentChangeStatus;
  sourceUrl: string;
}

/**
 * Content-safe, maintainer-reviewed summaries derived from profile candidates.
 * Raw evidence, hashes, cache paths, and candidate payloads never belong here.
 */
export const agentChanges: readonly AgentChange[] = [
  {
    id: '2026-08-22-claude-code-project-rules',
    observedAt: '2026-08-22T10:32:40Z',
    agentId: 'claude-code',
    agentName: 'Claude Code',
    title: 'Project rules directory observed',
    summary:
      'Claude Code documentation now identifies a project rules directory alongside CLAUDE.md.',
    before: 'Project instructions were represented by CLAUDE.md files.',
    after: 'Projects can also organize scoped Markdown rules under .claude/rules/*.md.',
    status: 'observed',
    sourceUrl: 'https://docs.anthropic.com/en/docs/claude-code/memory',
  },
  {
    id: '2026-08-22-codex-agent-overrides',
    observedAt: '2026-08-22T10:36:43Z',
    agentId: 'codex',
    agentName: 'OpenAI Codex',
    title: 'Override instruction files observed',
    summary: 'Codex documentation now identifies explicit global and project override files.',
    before: 'Instructions were represented by global and project AGENTS.md files.',
    after:
      'The profile also recognizes ~/.codex/AGENTS.override.md and project AGENTS.override.md.',
    status: 'observed',
    sourceUrl: 'https://developers.openai.com/codex/guides/agents-md',
  },
].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
