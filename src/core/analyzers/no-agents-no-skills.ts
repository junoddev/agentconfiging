/**
 * no-agents-no-skills — PORTED from ../markdowning
 * `analyzers/no_agents_no_skills.ex`.
 *
 * Fires when Claude Code is detected but the detector counted zero
 * subagents and zero skills.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { detected } from './shared.js';

registerAnalyzer({
  id: 'no-agents-no-skills',

  analyze(input: AnalyzerInput): Finding[] {
    const claude = detected(input, 'claude-code');
    if (!claude) return [];
    if (claude.extras['agentsCount'] !== 0 || claude.extras['skillsCount'] !== 0) return [];
    return [
      {
        id: 'no-agents-no-skills',
        severity: 'info',
        agent: 'claude-code',
        title: 'No custom subagents or skills configured',
        detail:
          "Claude Code is set up here but there's nothing in `.claude/agents/` or " +
          '`.claude/skills/`. Custom subagents and skills are the main way to encode ' +
          'reusable patterns for a team.',
        suggestion:
          'Skim the Claude Code docs for skill examples and add one that captures your ' +
          'most common workflow.',
      },
    ];
  },
});
