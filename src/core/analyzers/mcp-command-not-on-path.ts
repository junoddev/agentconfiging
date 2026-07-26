/**
 * mcp-command-not-on-path — NEW (parser-powered, env-bag gated).
 *
 * An analyzer can never probe PATH itself (analyze() has zero I/O), so
 * this check fires only from report-carried facts: the CALLER may collect
 * the resolvable command names up front and pass them as
 * `env.pathCommands` (see AnalyzerEnv in report.ts). When that fact is
 * absent, the whole check is skipped — no finding, never a guess.
 *
 * Only bare command names (no path separator) are checked: a command like
 * `./tools/bus-mcp` is resolved relative to a working directory, not PATH.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { findingId } from './shared.js';

registerAnalyzer({
  id: 'mcp-command-not-on-path',

  analyze(input: AnalyzerInput): Finding[] {
    const pathCommands = input.env?.pathCommands;
    if (!pathCommands) return []; // env fact absent — skip the check entirely
    const onPath = new Set(pathCommands);
    const servers = input.parsed.mcp?.model.servers ?? [];
    const findings: Finding[] = [];
    for (const server of servers) {
      const command = server.command;
      if (command === undefined) continue;
      if (command.includes('/') || command.includes('\\')) continue; // path-form, not a PATH lookup
      if (onPath.has(command)) continue;
      findings.push({
        id: findingId('mcp-command-not-on-path', server.name, command),
        severity: 'warning',
        agent: 'claude-code',
        title: `MCP server \`${server.name}\` command \`${command}\` not found on PATH`,
        detail:
          `\`.mcp.json\` starts server \`${server.name}\` with \`${command}\`, which is not ` +
          'among the executables resolvable on PATH. The server will fail to launch.',
        suggestion: `Install \`${command}\` or correct the command in \`.mcp.json\`.`,
      });
    }
    return findings;
  },
});
