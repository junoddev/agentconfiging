/**
 * missing-project-guide — PORTED from ../markdowning
 * `analyzers/missing_project_guide.ex`, plus a machine fix (create the
 * missing guide as a thin pointer to an existing one).
 *
 * Fires once per (detected runtime, absent guide file) pair. Skipped for
 * global-scope manifests (a manifest rooted at ~/.claude etc. has no repo
 * root to hold a guide).
 */

import { dirPrefix } from '../detectors/shared.js';
import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { detected, findingId, hasFile } from './shared.js';

const PAIRS = [
  { kind: 'claude-code', dir: '.claude', guide: 'CLAUDE.md', label: 'Claude Code' },
  { kind: 'codex', dir: '.codex', guide: 'AGENTS.md', label: 'Codex' },
  { kind: 'gemini-cli', dir: '.gemini', guide: 'GEMINI.md', label: 'Gemini CLI' },
] as const;

const GUIDES = PAIRS.map((p) => p.guide);

registerAnalyzer({
  id: 'missing-project-guide',

  analyze(input: AnalyzerInput): Finding[] {
    const findings: Finding[] = [];
    for (const { kind, dir, guide, label } of PAIRS) {
      // Global scope: the manifest root IS the runtime dir — no repo root.
      if (dirPrefix(input.manifest, dir) === '') continue;
      if (!detected(input, kind) || hasFile(input, guide)) continue;

      const existing = GUIDES.find((g) => g !== guide && hasFile(input, g));
      const patch = existing
        ? `# ${input.manifest.cwdBasename}\n\nSee ${existing} — the canonical agent guide for this project.\n`
        : `# ${input.manifest.cwdBasename}\n\nDescribe the stack, how to build and test, and project conventions here.\n`;

      findings.push({
        id: findingId('missing-project-guide', guide),
        severity: 'warning',
        agent: kind,
        title: `Missing ${guide}`,
        detail:
          `${label} is configured in this project but there's no \`${guide}\` at the repo root. ` +
          'The agent will work, but it loses the fastest way to pick up project-specific conventions.',
        suggestion:
          `Create \`${guide}\` with a short overview of the project: how to run it, test it, ` +
          'and the main architectural patterns.',
        fix: { kind: 'create-file', edits: [{ path: guide, patch }] },
      });
    }
    return findings;
  },
});
