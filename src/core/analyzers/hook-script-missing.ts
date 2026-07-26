/**
 * hook-script-missing — NEW (parser-powered).
 *
 * Fires when a hook command in `.claude/settings.json` /
 * `settings.local.json` references a script under `.claude/` that is not
 * in the manifest. Manifest-fact soundness: the scanner always collects
 * everything under `.claude/`, so a `.claude/...` script that existed
 * would be present. Commands whose first token is anything else (bare
 * executables like `npx`, paths outside `.claude/`) are not judgeable
 * from manifest facts and are skipped.
 */

import type { Finding } from '../findings.js';
import type { ClaudeSettings } from '../parsers/index.js';
import type { AnalyzerInput, ParsedFile } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { findingId, hasFile } from './shared.js';

registerAnalyzer({
  id: 'hook-script-missing',

  analyze(input: AnalyzerInput): Finding[] {
    const files = [input.parsed.settings, input.parsed.localSettings].filter(
      (f): f is ParsedFile<ClaudeSettings> => f !== undefined,
    );
    const findings: Finding[] = [];
    for (const file of files) {
      for (const group of file.model.hooks) {
        for (const hook of group.hooks) {
          if (hook.command === undefined) continue;
          const token = hook.command.trim().split(/\s+/)[0] ?? '';
          const script = token.startsWith('./') ? token.slice(2) : token;
          if (!script.startsWith('.claude/')) continue; // not judgeable from manifest facts
          if (hasFile(input, script)) continue;
          findings.push({
            id: findingId('hook-script-missing', group.event, script),
            severity: 'error',
            agent: 'claude-code',
            title: `Hook script \`${script}\` not found`,
            detail:
              `\`${file.path}\` wires a ${group.event} hook to \`${script}\`, but no such ` +
              'file exists in the project. The hook will fail every time the event fires.',
            suggestion: `Create \`${script}\` or remove the hook entry.`,
          });
        }
      }
    }
    return findings;
  },
});
