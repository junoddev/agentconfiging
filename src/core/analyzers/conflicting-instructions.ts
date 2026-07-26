/**
 * conflicting-instructions — UPGRADED from ../markdowning
 * `analyzers/conflicting_instructions.ex`.
 *
 * The Elixir version compared raw WORD COUNTS of CLAUDE.md / AGENTS.md /
 * GEMINI.md (ratio > 2× fired). This version is content-aware: it compares
 * the guides' normalized DIRECTIVE lines (bullet / numbered items, parsed
 * fence-aware via the guide parser) using `directiveSimilarity` — per-line
 * best-match token Jaccard averaged over the smaller guide — so PARAPHRASED
 * directives ("Run `npm test` before committing" vs "Before you commit, run
 * npm test") count as similar and do not fire; only guides whose directives
 * genuinely differ (different commands, values, topics) do.
 *
 * Fires once per divergent guide pair when both have >= 3 directive lines
 * and the similarity is below 0.45.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { directiveLines, directiveSimilarity, findingId } from './shared.js';

const GUIDE_PATHS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const;
const MIN_DIRECTIVES = 3;
const SIMILARITY_THRESHOLD = 0.45;

registerAnalyzer({
  id: 'conflicting-instructions',

  analyze(input: AnalyzerInput): Finding[] {
    const guides: { path: string; directives: string[] }[] = [];
    for (const path of GUIDE_PATHS) {
      const parsed = input.parsed.guides.find((g) => g.path === path);
      if (parsed) guides.push({ path, directives: directiveLines(parsed.model.body) });
    }

    const findings: Finding[] = [];
    for (let i = 0; i < guides.length; i += 1) {
      for (let j = i + 1; j < guides.length; j += 1) {
        const a = guides[i];
        const b = guides[j];
        if (!a || !b) continue;
        if (a.directives.length < MIN_DIRECTIVES || b.directives.length < MIN_DIRECTIVES) continue;
        const similarity = directiveSimilarity(a.directives, b.directives);
        if (similarity >= SIMILARITY_THRESHOLD) continue;
        const pct = Math.round(similarity * 100);
        findings.push({
          id: findingId('conflicting-instructions', a.path, b.path),
          severity: 'warning',
          agent: 'multi',
          title: `\`${a.path}\` and \`${b.path}\` diverge`,
          detail:
            `Both guides carry substantive instructions (${a.directives.length} vs ` +
            `${b.directives.length} directive lines) but their directive similarity is ` +
            `only ${pct}%. Agents reading different files will get different answers ` +
            'about the same codebase.',
          suggestion:
            'Pick one as the canonical guide and make the other a thin pointer ' +
            '(e.g. `See CLAUDE.md`), or sync them with the instruction sync engine.',
        });
      }
    }
    return findings;
  },
});
