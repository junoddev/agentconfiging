/**
 * settings-local-committed — PORTED from ../markdowning
 * `analyzers/settings_local_committed.ex`, plus a machine fix (add the
 * ignore line to `.gitignore`, creating it if absent).
 *
 * Fires when `.claude/settings.local.json` exists AND `.gitignore` is
 * missing or does not mention `settings.local.json`. Skipped for
 * global-scope manifests (~/.claude is not a git worktree concern).
 * When `.gitignore` exists but its content was withheld (binary/over cap)
 * we cannot verify — no finding rather than a guess.
 */

import { dirPrefix, findFile } from '../detectors/shared.js';
import type { Finding, Fix } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';

registerAnalyzer({
  id: 'settings-local-committed',

  analyze(input: AnalyzerInput): Finding[] {
    const prefix = dirPrefix(input.manifest, '.claude');
    if (prefix === '') return []; // global scope
    const localPath = `${prefix}settings.local.json`;
    if (!findFile(input.manifest, localPath)) return [];

    const gitignore = findFile(input.manifest, '.gitignore');
    let detail: string;
    let fix: Fix;
    const ignoreLine = `${localPath}\n`;
    if (!gitignore) {
      detail =
        `\`${localPath}\` is present but this project has no \`.gitignore\`. ` +
        "Local settings often contain personal tokens or opt-ins that shouldn't be shared.";
      fix = { kind: 'create-file', edits: [{ path: '.gitignore', patch: ignoreLine }] };
    } else {
      if (typeof gitignore.content !== 'string') return []; // cannot verify
      if (gitignore.content.includes('settings.local.json')) return [];
      detail =
        `\`${localPath}\` is present and not listed in \`.gitignore\`. ` +
        "Local settings often contain personal tokens or opt-ins that shouldn't be shared.";
      const base = gitignore.content.endsWith('\n') ? gitignore.content : `${gitignore.content}\n`;
      fix = { kind: 'replace-file', edits: [{ path: '.gitignore', patch: base + ignoreLine }] };
    }

    return [
      {
        id: 'settings-local-committed',
        severity: 'error',
        agent: 'claude-code',
        title: `\`${localPath}\` may be committed`,
        detail,
        suggestion:
          `Add \`${localPath}\` to \`.gitignore\` and run ` +
          `\`git rm --cached ${localPath}\` if it's already tracked.`,
        fix,
      },
    ];
  },
});
