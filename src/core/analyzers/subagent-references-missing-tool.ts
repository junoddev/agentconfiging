/**
 * subagent-references-missing-tool — NEW (parser-powered).
 *
 * Fires when a `.claude/agents/*.md` subagent's frontmatter `tools` list
 * names a tool that is not a known Claude Code built-in (data list in
 * known-tools.ts). Conservative by construction: matching is
 * case-insensitive, `mcp__*` names (MCP-provided tools), permission-style
 * patterns (containing '('), and `*` are never flagged — only bare names
 * in no recognized category fire.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { KNOWN_CLAUDE_TOOLS, KNOWN_TOOLS_DATE } from './known-tools.js';
import { registerAnalyzer } from './registry.js';
import { findingId } from './shared.js';

const KNOWN = new Set(KNOWN_CLAUDE_TOOLS.map((t) => t.toLowerCase()));

registerAnalyzer({
  id: 'subagent-references-missing-tool',

  analyze(input: AnalyzerInput): Finding[] {
    const findings: Finding[] = [];
    for (const subagent of input.parsed.subagents) {
      for (const tool of subagent.model.tools) {
        if (tool === '*' || tool.includes('(') || tool.toLowerCase().startsWith('mcp__')) continue;
        if (KNOWN.has(tool.toLowerCase())) continue;
        const name = subagent.model.name ?? subagent.path;
        findings.push({
          id: findingId('subagent-references-missing-tool', name, tool),
          severity: 'info',
          agent: 'claude-code',
          title: `Subagent \`${name}\` references unrecognized tool \`${tool}\``,
          detail:
            `\`${subagent.path}\` lists \`${tool}\` in its tools, but that is not in the ` +
            `known built-in tool list as of ${KNOWN_TOOLS_DATE} and does not look like an ` +
            'MCP tool name — it may be a newer tool or a typo. If it is a typo, the ' +
            'subagent will run without the tool.',
          suggestion:
            'Verify the name against the current Claude Code tool list; fix the spelling, ' +
            'or — if it comes from an MCP server — use its full `mcp__<server>__<tool>` name.',
        });
      }
    }
    return findings;
  },
});
