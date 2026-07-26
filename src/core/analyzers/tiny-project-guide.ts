/**
 * tiny-project-guide — UPGRADED from ../markdowning
 * `analyzers/tiny_project_guide.ex`: same size heuristic, but gated on the
 * runtime actually being DETECTED (the Elixir original flagged any tiny
 * guide file, even for runtimes with no other presence).
 *
 * Fires when a detected runtime's guide file exists but is under 200
 * characters — too short to carry real project context.
 */

import { findFile } from '../detectors/shared.js';
import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { detected, findingId } from './shared.js';

const PAIRS = [
  { kind: 'claude-code', guide: 'CLAUDE.md' },
  { kind: 'codex', guide: 'AGENTS.md' },
  { kind: 'gemini-cli', guide: 'GEMINI.md' },
] as const;

const MIN_CHARS = 200;

registerAnalyzer({
  id: 'tiny-project-guide',

  analyze(input: AnalyzerInput): Finding[] {
    const findings: Finding[] = [];
    for (const { kind, guide } of PAIRS) {
      if (!detected(input, kind)) continue;
      const content = findFile(input.manifest, guide)?.content;
      if (typeof content !== 'string' || content.length >= MIN_CHARS) continue;
      findings.push({
        id: findingId('tiny-project-guide', guide),
        severity: 'info',
        agent: kind,
        title: `\`${guide}\` is very short`,
        detail:
          `\`${guide}\` is only ${content.length} characters. A guide this short usually ` +
          "can't cover the context an agent needs — stack, scripts, conventions, gotchas.",
        suggestion:
          'Aim for ~200–1000 words. Describe the stack, how to run tests, naming ' +
          'conventions, and any foot-guns specific to this codebase.',
      });
    }
    return findings;
  },
});
