import { describe, expect, it } from 'vitest';
import { detect } from './detectors/index.js';
import { type Finding } from './findings.js';
import { parseManifest, type Manifest } from './manifest.js';
import { assessConfigQuality, computeQualityScore } from './quality.js';
import { buildAnalyzerInput, buildReport, runAnalyzers } from './report.js';

function makeManifest(files: Record<string, string>, cwdBasename = 'proj'): Manifest {
  return parseManifest({
    root: '/tmp/proj',
    cwdBasename,
    files: Object.entries(files).map(([path, content]) => ({
      path,
      size: content.length,
      sha256: '0'.repeat(64),
      content,
    })),
    stats: { fileCount: Object.keys(files).length, totalBytes: 0 },
  });
}

function findingsFor(files: Record<string, string>): Finding[] {
  const manifest = makeManifest(files);
  return runAnalyzers(buildAnalyzerInput(manifest, detect(manifest))).filter((f) =>
    f.id.startsWith('quality-bloat'),
  );
}

function qualityFor(files: Record<string, string>) {
  const manifest = makeManifest(files);
  return assessConfigQuality(buildAnalyzerInput(manifest, detect(manifest)));
}

const healthyGuide = `# Project Guide

## Workflow

- Always run npm test before committing.
- Never commit secrets or tokens.
- Do not push without maintainer approval.

## Style

- Keep changes small and scoped.
- Use TypeScript strictness as the source of truth.
- Prefer existing helpers before adding new abstractions.
`;

describe('agent config quality score', () => {
  it('scores a healthy guide near 100 and emits no quality findings', () => {
    const assessment = qualityFor({ 'CLAUDE.md': healthyGuide });

    expect(assessment.quality.score).toBeGreaterThanOrEqual(90);
    expect(assessment.quality.metrics).toMatchObject({
      guideCount: 1,
      buriedCriticalRuleCount: 0,
      contradictionCount: 0,
    });
    expect(assessment.issues).toEqual([]);
    expect(findingsFor({ 'CLAUDE.md': healthyGuide })).toEqual([]);
  });

  it('penalizes bloated, low-signal instruction context', () => {
    const prose = Array.from(
      { length: 260 },
      () =>
        'This background narrative exists for historical context and repeats the same low signal process notes without concrete agent directives.',
    ).join('\n\n');
    const assessment = qualityFor({ 'CLAUDE.md': `# Large Guide\n\n${prose}\n` });
    const findings = findingsFor({ 'CLAUDE.md': `# Large Guide\n\n${prose}\n` });

    expect(assessment.quality.score).toBeLessThan(75);
    expect(
      assessment.quality.components.find((c) => c.id === 'token-efficiency')?.score,
    ).toBeLessThan(75);
    expect(findings.map((f) => f.id)).toContain('quality-bloat-token-efficiency');
  });

  it('flags critical rules buried late in long guides', () => {
    const filler = Array.from({ length: 90 }, (_, i) => `- Background note ${i}`).join('\n');
    const guide = `# Guide\n\n${filler}\n- Never commit secrets or credentials.\n`;
    const findings = findingsFor({ 'CLAUDE.md': guide });

    expect(findings.map((f) => f.id)).toContain('quality-bloat-buried-critical-rule-claude-md-93');
    expect(findings.find((f) => f.id.includes('buried'))?.detail).toContain('`CLAUDE.md`');
  });

  it('flags buried prose and bold critical callouts while ignoring fenced callouts', () => {
    const filler = Array.from({ length: 90 }, (_, i) => `Background note ${i}`).join('\n');
    const guide = [
      '# Guide',
      '',
      filler,
      '```md',
      '**Critical:** Never push without approval.',
      '```',
      '**Important:** Never commit secrets or credentials.',
    ].join('\n');
    const findings = findingsFor({ 'CLAUDE.md': guide });
    const buriedIds = findings
      .filter((f) => f.id.includes('buried-critical-rule'))
      .map((f) => f.id);

    expect(buriedIds).toEqual(['quality-bloat-buried-critical-rule-claude-md-96']);
  });

  it('flags unclear guides with vague prose and weak structure', () => {
    const guide = [
      '# Guide',
      '',
      'Use best judgment and be careful. Handle things appropriately as needed. Make it good.',
      '',
      Array.from(
        { length: 35 },
        () =>
          'This paragraph keeps going with operational context but avoids concrete commands, ownership boundaries, file names, and explicit pass or fail criteria for the agent.',
      ).join(' '),
    ].join('\n');
    const findings = findingsFor({ 'CLAUDE.md': guide });

    expect(findings.map((f) => f.id)).toContain('quality-bloat-unclear-content-claude-md');
  });

  it('ignores vague prose inside fenced examples', () => {
    const fencedVagueLines = Array.from(
      { length: 20 },
      () => 'Use best judgment and be careful; handle things appropriately as needed.',
    ).join('\n');
    const guide = [
      '# Guide',
      '',
      '## Workflow',
      '',
      '- Always run npm test before committing.',
      '- Never commit secrets or tokens.',
      '- Do not push without maintainer approval.',
      '',
      '```md',
      fencedVagueLines,
      '```',
    ].join('\n');
    const findings = findingsFor({ 'CLAUDE.md': guide });

    expect(findings.map((f) => f.id)).not.toContain('quality-bloat-unclear-content-claude-md');
  });

  it('flags cross-runtime contradictions deterministically', () => {
    const findings = findingsFor({
      'CLAUDE.md': '# Claude\n\n- Always run tests before committing.\n- Never push changes.\n',
      'AGENTS.md': '# Codex\n\n- Do not run tests for small changes.\n- Always push changes.\n',
    });

    expect(findings.map((f) => f.id)).toEqual([
      'quality-bloat-contradiction-pushes-agents-md-4-claude-md-4',
      'quality-bloat-contradiction-tests-agents-md-3-claude-md-3',
      'quality-bloat-score',
    ]);
    expect(findings.map((f) => f.agent)).toEqual(['multi', 'multi', 'multi']);
  });

  it('flags contradictory distinct directives within one guide', () => {
    const findings = findingsFor({
      'AGENTS.md': '# Guide\n\n- Always run tests before committing.\n- Never run tests.\n',
    });

    expect(findings.map((f) => f.id)).toContain(
      'quality-bloat-contradiction-tests-agents-md-3-agents-md-4',
    );
    expect(findings.find((f) => f.id.includes('contradiction-tests'))?.agent).toBe('codex');
  });

  it('deduplicates repeated identical claims before pairing contradictions', () => {
    const findings = findingsFor({
      'AGENTS.md': [
        '# Guide',
        '',
        '- Always run tests before committing.',
        '- Always run tests before committing.',
        '- Never run tests.',
      ].join('\n'),
    });

    expect(findings.filter((f) => f.id.includes('contradiction-tests')).map((f) => f.id)).toEqual([
      'quality-bloat-contradiction-tests-agents-md-3-agents-md-5',
    ]);
  });

  it('flags concrete cross-runtime policy contradictions without leaking directive text', () => {
    const files = {
      'CLAUDE.md': [
        '# Claude',
        '',
        '- Always run `npm test` before finishing.',
        '- Indent with tabs.',
        '- PSP calls retry up to 2 times.',
        '```md',
        '- Always run `pnpm test` before finishing.',
        '- Indent with 8 spaces.',
        '- PSP calls retry up to 9 times.',
        '```',
      ].join('\n'),
      'AGENTS.md': [
        '# Codex',
        '',
        '- Always run `yarn test` before finishing.',
        '- Indent with 2 spaces.',
        '- PSP calls retry up to 5 times.',
      ].join('\n'),
    };
    const first = findingsFor(files);
    const second = findingsFor(files);
    const ids = first.map((f) => f.id);
    const json = JSON.stringify(first);

    expect(ids).toEqual([
      'quality-bloat-contradiction-indentation-agents-md-4-claude-md-4',
      'quality-bloat-contradiction-retry-count-agents-md-5-claude-md-5',
      'quality-bloat-contradiction-test-command-agents-md-3-claude-md-3',
      'quality-bloat-score',
    ]);
    expect(second.map((f) => f.id)).toEqual(ids);
    expect(json).not.toContain('npm test');
    expect(json).not.toContain('yarn test');
    expect(json).not.toContain('pnpm test');
    expect(json).not.toContain('8 spaces');
    expect(json).not.toContain('9 times');
  });

  it('includes path-scoped Copilot instructions in parsed quality documents', () => {
    const manifest = makeManifest({
      'CLAUDE.md': '# Claude\n\n- Always run `npm test` before editing API routes.\n',
      '.github/instructions/api.instructions.md': [
        '---',
        'applyTo: "app/api/**/*.ts"',
        '---',
        '',
        '# API rules',
        '',
        '- Always run `pnpm test` before editing API routes.',
      ].join('\n'),
    });
    const input = buildAnalyzerInput(manifest, detect(manifest));
    const findings = runAnalyzers(input).filter((f) => f.id.startsWith('quality-bloat'));

    expect(input.parsed.guides.map((g) => g.path).sort()).toEqual([
      '.github/instructions/api.instructions.md',
      'CLAUDE.md',
    ]);
    expect(computeQualityScore(input).metrics.guideCount).toBe(2);
    expect(findings.map((f) => f.id)).toContain(
      'quality-bloat-contradiction-test-command-github-instructions-api-instructions-md-7-claude-md-3',
    );
  });

  it('does not contradict object-scoped secret commit rules with generic commit workflow', () => {
    const findings = findingsFor({
      'CLAUDE.md': '# Claude\n\n- Always commit completed work after tests pass.\n',
      'AGENTS.md': '# Codex\n\n- Never commit secrets or tokens.\n',
    });

    expect(findings.map((f) => f.id)).not.toContain(
      'quality-bloat-contradiction-commits-agents-md-3-claude-md-3',
    );
    expect(findings.some((f) => f.id.includes('contradiction-commits'))).toBe(false);
  });

  it('keeps score deterministic and does not leak adversarial file text', () => {
    const files = {
      'CLAUDE.md':
        '# Guide\n\n```md\n- Never commit this fenced example with sk-SECRET-123.\n```\n\n- Always run tests before committing.\n',
      'AGENTS.md': '# Guide\n\n- Always run tests before committing.\n',
    };

    const a = computeQualityScore(
      buildAnalyzerInput(makeManifest(files), detect(makeManifest(files))),
    );
    const b = computeQualityScore(
      buildAnalyzerInput(makeManifest(files), detect(makeManifest(files))),
    );
    const report = buildReport(makeManifest(files), detect(makeManifest(files)));
    const json = JSON.stringify({ quality: report.quality, findings: report.findings });

    expect(a).toEqual(b);
    expect(report.quality.metrics.criticalRuleCount).toBe(2);
    expect(json).not.toContain('sk-SECRET-123');
    expect(json).not.toContain('fenced example');
  });
});
