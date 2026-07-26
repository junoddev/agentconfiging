/**
 * rules-drift — UPGRADED from ../markdowning
 * `analyzers/cursor_and_claude_rules_drift.ex`.
 *
 * The Elixir version gated on raw byte size (> 500 chars each) and
 * compared raw word-token Jaccard over whole files (< 20% fired). This
 * version is content-aware: `.cursorrules` and `CLAUDE.md` are compared by
 * their normalized DIRECTIVE lines (bullets / numbered items, fence-aware)
 * via `directiveSimilarity` (per-line best-match token Jaccard, averaged),
 * so paraphrased rules count as similar. Both files need >= 2 directives;
 * similarity below 0.45 fires.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { directiveLines, directiveSimilarity } from './shared.js';

const MIN_DIRECTIVES = 2;
const SIMILARITY_THRESHOLD = 0.45;

registerAnalyzer({
  id: 'rules-drift',

  analyze(input: AnalyzerInput): Finding[] {
    const cursor = input.parsed.guides.find((g) => g.path === '.cursorrules');
    const claude = input.parsed.guides.find((g) => g.path === 'CLAUDE.md');
    if (!cursor || !claude) return [];
    const cursorLines = directiveLines(cursor.model.body);
    const claudeLines = directiveLines(claude.model.body);
    if (cursorLines.length < MIN_DIRECTIVES || claudeLines.length < MIN_DIRECTIVES) return [];
    const similarity = directiveSimilarity(cursorLines, claudeLines);
    if (similarity >= SIMILARITY_THRESHOLD) return [];
    const pct = Math.round(similarity * 100);
    return [
      {
        id: 'rules-drift',
        severity: 'info',
        agent: 'multi',
        title: '`.cursorrules` and `CLAUDE.md` look unrelated',
        detail:
          `Both files carry directives (${cursorLines.length} vs ${claudeLines.length} ` +
          `lines) but their directive similarity is only ${pct}%. That usually means the ` +
          'two agents are being told different things about the same codebase.',
        suggestion:
          'Pick one canonical guide and have the other file point to it, or extract the ' +
          'common ground into a shared `CONTRIBUTING.md`.',
      },
    ];
  },
});
