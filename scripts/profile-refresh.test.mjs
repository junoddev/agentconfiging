import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  buildManifest,
  classifyCandidate,
  computeCandidateHash,
  materializeReview,
} from './profile-refresh-policy.mjs';
import { makePlan, scheduledMode } from './profile-refresh-plan.mjs';

describe('profile refresh runner', () => {
  it('invokes the locally installed tsx through supported npm exec syntax', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-refresh-runner-'));
    const result = spawnSync(
      process.execPath,
      [
        'scripts/profile-refresh.mjs',
        '--agent',
        'not-a-canonical-profile',
        '--mode',
        'weekly',
        '--dry-run',
        '--output',
        path.join(root, 'output'),
        '--cache',
        path.join(root, 'cache'),
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(path.join(root, 'output', 'result.json'), 'utf8')).not.toContain(
      'Unknown command: "tsx"',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'output', 'run.json'), 'utf8')),
    ).toMatchObject({
      profileId: 'not-a-canonical-profile',
      complete: false,
    });
  });
});

describe('profile refresh planning', () => {
  it('selects monthly before weekly and otherwise daily', () => {
    expect(scheduledMode(new Date('2026-06-01T02:00:00Z'))).toBe('monthly');
    expect(scheduledMode(new Date('2026-06-08T02:00:00Z'))).toBe('weekly');
    expect(scheduledMode(new Date('2026-06-09T02:00:00Z'))).toBe('daily');
  });
  it('rejects unsafe dispatch selectors', () => {
    expect(() => makePlan({ agent: '../codex' })).toThrow('invalid agent');
    expect(() => makePlan({ source: 'x; echo nope' })).toThrow('invalid source');
  });
  it('attests full audit only for the full roster with no source selector', () => {
    expect(makePlan({ agent: 'all', source: '' }).fullAudit).toBe(true);
    expect(makePlan({ agent: 'codex', source: '' }).fullAudit).toBe(false);
    expect(makePlan({ agent: 'codex', source: 'codex-instruction-docs' }).fullAudit).toBe(false);
  });
});

describe('profile refresh review policy', () => {
  it.each([
    [{ operation: 'remove', area: 'tools', after: null }, 'removal'],
    [
      {
        operation: 'change',
        area: 'instructionArtifacts',
        after: { value: { layout: 'rules-dir' } },
      },
      'path-or-layout',
    ],
    [
      {
        operation: 'add',
        area: 'settings',
        factId: 'ordinary-setting',
        after: { value: { key: 'color' } },
      },
      'settings-contract',
    ],
    [{ operation: 'change', area: 'models', after: { lifecycle: 'deprecated' } }, 'deprecation'],
    [
      { operation: 'add', area: 'tools', factId: 'permission-bypass', after: { value: {} } },
      'permissions-defaults-or-security',
    ],
  ])('forces human review for %s', (change, reason) => {
    expect(classifyCandidate({ semanticDiff: [change] })).toMatchObject({
      risk: 'high',
      reasons: expect.arrayContaining([reason]),
    });
  });

  it('retains non-extractable source drift as high-risk manual review', () => {
    expect(
      classifyCandidate({
        semanticDiff: [],
        sourceChanges: [
          {
            sourceId: 'codex-product-docs',
            afterContentHash: `sha256:${'a'.repeat(64)}`,
            requiresManualExtraction: true,
          },
        ],
        validation: { valid: true },
      }),
    ).toMatchObject({ risk: 'high', reasons: ['manual-extraction-required'] });
  });

  const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'profile-refresh-'));
  const writeRun = (root, id, status = 'clean', mode = 'weekly') => {
    const dir = path.join(root, `profile-refresh-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({
        profileId: id,
        mode,
        exitCode: status === 'fetch-failure' ? 2 : 0,
        complete: status === 'clean' || status === 'drift',
      }),
    );
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ profileId: id, status }));
    return dir;
  };
  const writeCandidate = (dir, id, overrides = {}) => {
    const candidateId = `${id}-20260815-abc123`;
    const value = {
      schemaVersion: 1,
      profileId: id,
      candidateId,
      candidateHash: `sha256:${'a'.repeat(64)}`,
      baseProfileHash: `sha256:${'b'.repeat(64)}`,
      basedOnProfileRevision: 1,
      profile: { schemaVersion: 1, id, sources: [], facts: {} },
      validation: { valid: true },
      semanticDiff: [],
      sourceChanges: [],
      sourceSnapshotIds: [],
      ...overrides,
    };
    value.candidateHash = overrides.candidateHash ?? computeCandidateHash(value);
    const file = path.join(dir, `${candidateId}.candidate.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  it('preserves stale review state for partial and total failures', () => {
    const partial = temp();
    writeRun(partial, 'codex');
    expect(buildManifest(partial, ['codex', 'claude-code'])).toMatchObject({
      complete: false,
      canCloseStale: false,
      unresolvedProfiles: ['claude-code'],
    });
    const failed = temp();
    writeRun(failed, 'codex', 'fetch-failure');
    expect(buildManifest(failed, ['codex'])).toMatchObject({
      complete: false,
      canCloseStale: false,
      unresolvedProfiles: ['codex'],
    });
  });

  it('allows stale cleanup only after a complete clean weekly/monthly matrix', () => {
    const weekly = temp();
    writeRun(weekly, 'codex', 'clean', 'weekly');
    expect(buildManifest(weekly, ['codex'], true).canCloseStale).toBe(true);
    const daily = temp();
    writeRun(daily, 'codex', 'clean', 'daily');
    expect(buildManifest(daily, ['codex']).canCloseStale).toBe(false);
  });

  it('denies global stale cleanup for targeted agent or source audits', () => {
    const targeted = temp();
    writeRun(targeted, 'codex', 'clean', 'weekly');
    expect(buildManifest(targeted, ['codex'], false)).toMatchObject({
      complete: true,
      fullAudit: false,
      canCloseStale: false,
    });
    expect(buildManifest(targeted, ['codex'], true, ['claude-code', 'codex'])).toMatchObject({
      fullAudit: false,
      canCloseStale: false,
    });
  });

  it('rejects invalid, mismatched, and traversal-shaped candidates without materializing', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    writeCandidate(dir, 'codex', { candidateId: '../escape', validation: { valid: false } });
    const output = temp();
    const manifest = materializeReview(input, output, ['codex']);
    expect(manifest.rejectedCandidates[0]).toMatchObject({
      risk: 'high',
      reasons: ['invalid-candidate'],
    });
    expect(manifest.complete).toBe(false);
    expect(fs.readdirSync(output)).toHaveLength(0);
  });

  it('validates the envelope profile against the canonical roster before copying', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    writeCandidate(dir, 'codex', {
      profile: { schemaVersion: 1, id: 'claude-code', sources: [], facts: {} },
    });
    expect(buildManifest(input, ['codex']).rejectedCandidates[0].errors).toContain(
      'candidate profile id mismatch',
    );
  });

  it('materializes a schema-valid roster-matched candidate under a safe canonical path', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    writeCandidate(dir, 'codex');
    const output = temp();
    const manifest = materializeReview(input, output, ['codex'], undefined, true, ['codex']);
    expect(manifest).toMatchObject({ complete: true, canCloseStale: false });
    expect(fs.existsSync(path.join(output, 'codex', 'codex-20260815-abc123.candidate.json'))).toBe(
      true,
    );
  });

  it('keeps targeted drift candidates artifact-only and allows a verified full audit candidate', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    writeCandidate(dir, 'codex');
    expect(buildManifest(input, ['codex'], false, ['codex'])).toMatchObject({
      complete: true,
      fullAudit: false,
      canMutateReview: false,
    });
    expect(buildManifest(input, ['codex'], true, ['codex'])).toMatchObject({
      complete: true,
      fullAudit: true,
      canMutateReview: true,
    });
  });

  it('does not mutate review content for a mixed candidate and unresolved runtime', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    writeCandidate(dir, 'codex');
    writeRun(input, 'claude-code', 'fetch-failure');
    const output = temp();
    const manifest = materializeReview(input, output, ['codex', 'claude-code']);
    expect(manifest).toMatchObject({
      complete: false,
      canMutateReview: false,
      unresolvedProfiles: ['claude-code'],
    });
    expect(fs.readdirSync(output)).toHaveLength(0);
  });

  it('treats drift without a valid candidate as unresolved', () => {
    const input = temp();
    writeRun(input, 'codex', 'drift');
    expect(buildManifest(input, ['codex'])).toMatchObject({
      complete: false,
      canCloseStale: false,
      runtimeResults: [{ profileId: 'codex', resolved: false, status: 'drift' }],
    });
  });

  it('denies stale cleanup when a selected optional source was unresolved', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'clean', 'weekly');
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({
        profileId: 'codex',
        mode: 'weekly',
        exitCode: 0,
        complete: false,
        unresolvedSourceIds: ['codex-product-docs'],
      }),
    );
    expect(buildManifest(input, ['codex'], true, ['codex'])).toMatchObject({
      complete: false,
      canCloseStale: false,
      unresolvedProfiles: ['codex'],
    });
  });

  it('rejects tampered candidate/base hashes and source-change provenance', () => {
    const input = temp();
    const dir = writeRun(input, 'codex', 'drift');
    const body = 'changed source';
    const hash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const evidenceDir = path.join(path.dirname(dir), 'profile-refresh-codex', 'evidence', 'sha256');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, hash.slice(7)), body);
    const file = writeCandidate(dir, 'codex', {
      sourceSnapshotIds: [`codex-product-docs@${hash}`],
      sourceChanges: [
        { sourceId: 'codex-product-docs', afterContentHash: hash, requiresManualExtraction: true },
      ],
      profile: {
        schemaVersion: 1,
        id: 'codex',
        sources: [
          {
            id: 'codex-product-docs',
            latestSuccessfulRetrieval: { contentHash: hash },
          },
        ],
        facts: {},
      },
    });
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const trusted = { codex: value.baseProfileHash };
    const sources = { codex: { 'codex-product-docs': null } };
    expect(
      buildManifest(input, ['codex'], true, ['codex'], trusted, sources).rejectedCandidates,
    ).toHaveLength(0);

    value.candidateHash = `sha256:${'f'.repeat(64)}`;
    fs.writeFileSync(file, JSON.stringify(value));
    expect(
      buildManifest(input, ['codex'], true, ['codex'], trusted, sources).rejectedCandidates[0]
        .errors,
    ).toContain('candidate hash mismatch');

    value.candidateHash = computeCandidateHash(value);
    fs.writeFileSync(file, JSON.stringify(value));
    expect(
      buildManifest(
        input,
        ['codex'],
        true,
        ['codex'],
        { codex: `sha256:${'c'.repeat(64)}` },
        sources,
      ).rejectedCandidates[0].errors,
    ).toContain('base profile hash does not match canonical serialization');

    value.sourceChanges[0].sourceId = 'unknown-source';
    value.candidateHash = computeCandidateHash(value);
    fs.writeFileSync(file, JSON.stringify(value));
    expect(
      buildManifest(input, ['codex'], true, ['codex'], trusted, sources).rejectedCandidates[0]
        .errors,
    ).toEqual(
      expect.arrayContaining([
        'source change hash does not match candidate source',
        'source change has no matching snapshot id',
        'source change source is not canonical',
      ]),
    );

    value.sourceChanges[0].sourceId = 'codex-product-docs';
    value.sourceChanges[0].beforeContentHash = `sha256:${'d'.repeat(64)}`;
    value.candidateHash = computeCandidateHash(value);
    fs.writeFileSync(file, JSON.stringify(value));
    expect(
      buildManifest(input, ['codex'], true, ['codex'], trusted, sources).rejectedCandidates[0]
        .errors,
    ).toContain('source change prior hash does not match canonical source');
  });
});

describe('profile refresh workflow cache contract', () => {
  it('restores conditionally and always saves under a unique key', () => {
    const workflow = fs.readFileSync('.github/workflows/profile-refresh.yml', 'utf8');
    expect(workflow).toContain('actions/cache/restore@');
    expect(workflow).toContain("needs.plan.outputs.mode != 'monthly'");
    expect(workflow).toContain('actions/cache/save@');
    expect(workflow).toContain('${{ github.run_id }}-${{ github.run_attempt }}');
  });

  it('passes the planned cadence through the wrapper to the profile audit', () => {
    const wrapper = fs.readFileSync('scripts/profile-refresh.mjs', 'utf8');
    expect(wrapper).toContain("'--cadence'");
    expect(wrapper).toContain('mode');
    expect(wrapper).toContain("if (mode === 'daily') args.push('--metadata-only')");
    expect(wrapper).toContain("if (mode === 'monthly'");
  });
});
