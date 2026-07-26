/**
 * duplicate-rules — NEW (parser-powered).
 *
 * Duplicate / shadowed rule sources within one scope:
 *   1. Legacy `.cursorrules` alongside `.cursor/rules/*.mdc` — Cursor
 *      reads both, so the same project carries two rule sources that
 *      drift independently.
 *   2. Two `.claude/rules/**.md` files claiming the same title (first `#`
 *      heading). Same directory: always a duplicate. DIFFERENT directories
 *      may be legitimate namespacing (frontend/style.md vs backend/style.md),
 *      so those only fire when the bodies are also highly similar
 *      (token Jaccard > 0.8) — i.e. an actual copy, not a shared name.
 *
 * (Cross-scope duplicates — project vs ~/.claude — are not visible here:
 * a manifest covers exactly one scope.)
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { findingId, hasFile, tokenJaccard, tokens } from './shared.js';

const BODY_SIMILARITY_THRESHOLD = 0.8;

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

registerAnalyzer({
  id: 'duplicate-rules',

  analyze(input: AnalyzerInput): Finding[] {
    const findings: Finding[] = [];

    if (hasFile(input, '.cursorrules') && input.parsed.cursorRules.length > 0) {
      const mdcPaths = input.parsed.cursorRules.map((r) => r.path);
      findings.push({
        id: 'duplicate-rules-cursorrules-and-cursor-rules',
        severity: 'warning',
        agent: 'cursor',
        title: 'Both `.cursorrules` and `.cursor/rules/` are present',
        detail:
          `This project has the legacy \`.cursorrules\` file AND ${mdcPaths.length} rule ` +
          `file(s) under \`.cursor/rules/\`. Cursor reads both, so the two rule sources ` +
          'drift independently and can contradict each other.',
        suggestion:
          'Migrate the `.cursorrules` content into `.cursor/rules/*.mdc` files and delete ' +
          '`.cursorrules` (it is the deprecated format).',
      });
    }

    const byTitle = new Map<string, { path: string; body: string }[]>();
    for (const rule of input.parsed.rules) {
      const title = rule.model.title?.trim().toLowerCase();
      if (title === undefined || title.length === 0) continue;
      byTitle.set(title, [
        ...(byTitle.get(title) ?? []),
        { path: rule.path, body: rule.model.body },
      ]);
    }
    for (const [title, rules] of byTitle) {
      if (rules.length < 2) continue;
      // Same directory: duplicate by construction. Different directories:
      // only a duplicate when the bodies are near-copies (namespaced rules
      // like frontend/style.md vs backend/style.md legitimately share names).
      const duplicated = new Set<string>();
      for (let i = 0; i < rules.length; i += 1) {
        for (let j = i + 1; j < rules.length; j += 1) {
          const a = rules[i];
          const b = rules[j];
          if (!a || !b) continue;
          const isDuplicate =
            dirOf(a.path) === dirOf(b.path) ||
            tokenJaccard(tokens(a.body), tokens(b.body)) > BODY_SIMILARITY_THRESHOLD;
          if (isDuplicate) {
            duplicated.add(a.path);
            duplicated.add(b.path);
          }
        }
      }
      if (duplicated.size < 2) continue;
      const paths = [...duplicated].sort();
      findings.push({
        id: findingId('duplicate-rules', title),
        severity: 'warning',
        agent: 'claude-code',
        title: `Duplicate rule title "${title}"`,
        detail:
          `${paths.length} rule files claim the same title: ${paths.map((p) => `\`${p}\``).join(', ')}. ` +
          'Duplicated rules drift apart and leave the agent with contradictory guidance.',
        suggestion: 'Merge the duplicates into one rule file per topic.',
      });
    }

    return findings;
  },
});
