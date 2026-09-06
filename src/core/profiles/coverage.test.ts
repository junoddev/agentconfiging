import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { capabilityFreshness, profileCoverageMatrix } from './coverage.js';
import { AGENT_PROFILES } from './data.js';
import { CAPABILITY_AREAS } from './types.js';
import { RUNTIME_FORMATS } from '../runtimes/table.js';
import { RUNTIME_SOURCE_MANIFESTS } from './source-manifests.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('complete profile coverage operation', () => {
  it('publishes ownership and weekly/monthly sources for all 15 runtimes', () => {
    const matrix = profileCoverageMatrix();
    expect(matrix).toHaveLength(15);
    expect(matrix.filter((row) => row.supportTier === 'first-class')).toHaveLength(8);
    expect(matrix.filter((row) => row.supportTier === 'profile-sync-only')).toHaveLength(7);
    for (const row of matrix) {
      expect(row.owner).toBe(`runtime-maintainers/${row.profileId}`);
      expect(row.weeklySourceIds.length).toBeGreaterThan(0);
      expect(row.monthlySourceIds.length).toBeGreaterThan(0);
      expect(Object.keys(row.coverage).sort()).toEqual([...CAPABILITY_AREAS].sort());
      expect(Object.keys(row.freshness).sort()).toEqual([...CAPABILITY_AREAS].sort());
      for (const area of CAPABILITY_AREAS) {
        if (row.coverage[area] === 'unknown') expect(row.coverage[area]).not.toBe('unsupported');
      }
    }
  });

  it('matches a golden fixture for every runtime without changing projected behavior', () => {
    const fixtureDir = path.resolve('fixtures/profiles');
    const files = fs
      .readdirSync(fixtureDir)
      .filter((file) => file.endsWith('.json'))
      .sort();
    expect(files).toEqual(AGENT_PROFILES.map((profile) => `${profile.id}.json`).sort());
    for (const profile of AGENT_PROFILES) {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, `${profile.id}.json`), 'utf8'),
      ) as { profileId: string; supportTier: string; instructionPaths: string[] };
      const runtime = RUNTIME_FORMATS.find((item) => item.id === profile.id)!;
      const manifest =
        RUNTIME_SOURCE_MANIFESTS[profile.id as keyof typeof RUNTIME_SOURCE_MANIFESTS];
      expect(fixture).toEqual({
        profileId: profile.id,
        supportTier: profile.maintainer.supportTier,
        instructionPaths: profile.facts.instructionArtifacts.map((fact) => fact.value.path),
        runtimeFormatSha256: hash(runtime),
        sourceManifestSha256: hash(manifest),
      });
    }
  });

  it('does not convert an empty researched area into unsupported coverage', () => {
    for (const profile of AGENT_PROFILES) {
      for (const area of CAPABILITY_AREAS) {
        if (profile.facts[area].length === 0)
          expect(profile.coverage[area]).not.toBe('unsupported');
      }
    }
  });

  it('uses the worst required-source freshness and ignores optional sources', () => {
    const profile = structuredClone(AGENT_PROFILES.find((item) => item.id === 'codex')!);
    const required = profile.sources.find((source) => source.id === 'codex-instruction-docs')!;
    const optional = profile.sources.find((source) => source.id === 'codex-product-docs')!;
    required.freshness.status = 'stale';
    optional.required = true;
    optional.covers.push('instructionArtifacts');
    optional.freshness.status = 'expired';
    expect(capabilityFreshness(profile, 'instructionArtifacts')).toBe('expired');
    optional.required = false;
    optional.freshness.status = 'unavailable';
    expect(capabilityFreshness(profile, 'instructionArtifacts')).toBe('stale');
    expect(capabilityFreshness(profile, 'models')).toBe('unavailable');
  });
});
