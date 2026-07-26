/**
 * broken-import — NEW (parser-powered).
 *
 * Fires when a CLAUDE.md `@import` reference points at a path that is not
 * in the manifest. Manifest-fact soundness: the scanner walks the whole
 * project tree and includes every file with an allowed extension, so a
 * scannable target that existed would be in the manifest. Imports we
 * cannot judge from manifest facts are skipped: `~/`-prefixed (outside the
 * root), absolute paths, `../` escapes, and extensions the scanner does
 * not collect.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { ALLOWED_EXTS } from '../scanner.js';
import { registerAnalyzer } from './registry.js';
import { findingId, hasFile } from './shared.js';

function scannableExt(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return ALLOWED_EXTS.includes(path.slice(dot).toLowerCase());
}

registerAnalyzer({
  id: 'broken-import',

  analyze(input: AnalyzerInput): Finding[] {
    const claudeMd = input.parsed.claudeMd;
    if (!claudeMd) return [];
    const findings: Finding[] = [];
    for (const imp of claudeMd.model.imports) {
      if (imp.path.startsWith('~') || imp.path.startsWith('/') || imp.path.startsWith('..')) {
        continue; // outside the scanned root — not judgeable from the manifest
      }
      const target = imp.path.startsWith('./') ? imp.path.slice(2) : imp.path;
      if (!scannableExt(target)) continue; // scanner would not have collected it anyway
      if (hasFile(input, target)) continue;
      findings.push({
        id: findingId('broken-import', target),
        severity: 'warning',
        agent: 'claude-code',
        title: `Broken @import: \`${imp.path}\``,
        detail:
          `\`${claudeMd.path}\` line ${imp.line} imports \`@${imp.path}\`, but no such file ` +
          'exists in the project. Claude Code silently skips imports it cannot resolve, so ' +
          'the referenced context never reaches the agent.',
        suggestion: `Create \`${target}\` or remove the @import line.`,
      });
    }
    return findings;
  },
});
