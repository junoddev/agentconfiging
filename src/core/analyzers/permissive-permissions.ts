/**
 * permissive-permissions — UPGRADED from ../markdowning
 * `analyzers/permissive_permissions.ex`.
 *
 * The Elixir version JSON-decoded `.claude/settings.json` ad hoc. This
 * version reads the PARSED `ClaudeSettings` models (settings.json AND
 * settings.local.json) and flags:
 *   - `permissions.defaultMode == "bypassPermissions"`
 *   - `permissions.allow` containing `*` or `Bash(*)`
 * One finding per offending file.
 */

import type { Finding } from '../findings.js';
import type { ClaudeSettings } from '../parsers/index.js';
import type { AnalyzerInput, ParsedFile } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { findingId } from './shared.js';

function reasonsFor(settings: ClaudeSettings): string[] {
  const reasons: string[] = [];
  const permissions = settings.permissions;
  if (!permissions) return reasons;
  if (permissions.defaultMode === 'bypassPermissions') {
    reasons.push('`defaultMode` is set to `bypassPermissions`.');
  }
  if (permissions.allow.includes('*')) reasons.push('`permissions.allow` contains `*`.');
  if (permissions.allow.includes('Bash(*)')) {
    reasons.push('`permissions.allow` contains `Bash(*)`.');
  }
  return reasons;
}

registerAnalyzer({
  id: 'permissive-permissions',

  analyze(input: AnalyzerInput): Finding[] {
    const files = [input.parsed.settings, input.parsed.localSettings].filter(
      (f): f is ParsedFile<ClaudeSettings> => f !== undefined,
    );
    const findings: Finding[] = [];
    for (const file of files) {
      const reasons = reasonsFor(file.model);
      if (reasons.length === 0) continue;
      findings.push({
        id: findingId('permissive-permissions', file.path),
        severity: 'warning',
        agent: 'claude-code',
        title: 'Claude Code permissions are very permissive',
        detail:
          `\`${file.path}\` grants broad access that bypasses the usual approval prompts: ` +
          reasons.join(' '),
        suggestion:
          'Replace wildcard allowances with the specific tools/paths the agent actually ' +
          'needs, and remove `defaultMode: bypassPermissions` for shared environments.',
      });
    }
    return findings;
  },
});
