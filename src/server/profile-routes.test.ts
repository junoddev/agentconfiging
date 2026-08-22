import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCandidateEnvelope } from '../core/profiles/audit.js';
import { getAgentProfile } from '../core/profiles/index.js';
import { createApp } from './app.js';
import { pendingCandidates } from './profile-routes.js';
import { InstanceRegistry } from './registry.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-profiles-'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), 'ok');
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const token = 'profile-route-test-token';
const registry = new InstanceRegistry('test');
registry.seed(root, { makeDefault: true });
const app = createApp({
  tokenHash: createHash('sha256').update(token).digest(),
  port: () => 8787,
  distDir: dist,
  registry,
  version: 'test',
  pendingProfileDriftIds: new Set(['codex']),
});
const get = (pathname: string) =>
  app.fetch(
    new Request(`http://127.0.0.1:8787${pathname}`, {
      headers: { host: '127.0.0.1:8787', authorization: `Bearer ${token}` },
    }),
  );

describe('content-safe profile API', () => {
  it('continues past a malformed candidate to a later valid current candidate', () => {
    const candidates = path.join(root, 'candidate-ordering');
    fs.mkdirSync(candidates);
    fs.writeFileSync(path.join(candidates, '000-broken.candidate.json'), '{not json');
    const canonical = getAgentProfile('codex')!;
    const profile = structuredClone(canonical);
    profile.facts.instructionArtifacts[0]!.confidence = 'corroborated';
    const envelope = buildCandidateEnvelope(canonical, profile, [], '2026-08-15T12:00:00Z', [], []);
    fs.writeFileSync(
      path.join(candidates, `${envelope.candidateId}.candidate.json`),
      JSON.stringify(envelope),
    );
    expect([...pendingCandidates(candidates)]).toEqual(['codex']);
  });

  it('lists summaries and reports drift without internal audit material', async () => {
    const response = await get('/api/profiles');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { profiles: Array<Record<string, unknown>> };
    expect(body.profiles.find((profile) => profile['id'] === 'codex')?.['pendingDrift']).toBe(true);
    const wire = JSON.stringify(body);
    for (const forbidden of [
      'promotion',
      'contentHash',
      'candidateHash',
      'cachePath',
      'diagnostics',
      'prompt',
    ])
      expect(wire).not.toContain(forbidden);
  });

  it('returns safe detail and a constant unknown response', async () => {
    const detail = await get('/api/profiles/codex');
    expect(detail.status).toBe(200);
    const wire = await detail.text();
    expect(wire).toContain('instructionArtifacts');
    expect(wire).not.toContain('promotion');
    expect((await get('/api/profiles/not-real')).status).toBe(404);
  });
});
