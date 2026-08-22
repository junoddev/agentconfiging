import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpFetch, HttpResponse } from '../registry/client.js';
import {
  auditAgentProfile,
  assertAllowlistedProfileSource,
  buildCandidateEnvelope,
  extractInstructionPaths,
  isCurrentProfileCandidate,
  semanticProfileDiff,
} from './audit.js';
import { getAgentProfile, serializeAgentProfiles } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-audit-'));
  dirs.push(dir);
  return dir;
}
function response(body: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[key.toLowerCase()] ?? null },
    text: async () => body,
  };
}
const publicDns = async () => ['93.184.216.34'];

describe('profile audit extraction and candidate contract', () => {
  it('accepts only intact candidates based on the current canonical profile', () => {
    const canonical = getAgentProfile('codex')!;
    const candidate = structuredClone(canonical);
    candidate.facts.instructionArtifacts[0]!.confidence = 'corroborated';
    const envelope = buildCandidateEnvelope(
      canonical,
      candidate,
      [],
      '2026-08-15T12:00:00Z',
      [],
      [],
    );
    expect(
      isCurrentProfileCandidate(envelope, canonical, `${envelope.candidateId}.candidate.json`),
    ).toBe(true);
    expect(isCurrentProfileCandidate(envelope, canonical, 'wrong.candidate.json')).toBe(false);
    expect(
      isCurrentProfileCandidate(
        { ...envelope, candidateHash: `sha256:${'f'.repeat(64)}` },
        canonical,
      ),
    ).toBe(false);
    expect(
      isCurrentProfileCandidate(
        { ...envelope, basedOnProfileRevision: canonical.profileRevision - 1 },
        canonical,
      ),
    ).toBe(false);
  });
  it('extracts bounded code-semantic paths for both pilots without prose/script false positives', () => {
    expect(
      extractInstructionPaths(
        getAgentProfile('codex')!,
        '<script>AGENTS.override.md</script><p>AGENTS.override.md</p><code>AGENTS.md</code><code>AGENTS.override.md</code>',
      ),
    ).toEqual(['AGENTS.md', 'AGENTS.override.md']);
    expect(
      extractInstructionPaths(
        getAgentProfile('claude-code')!,
        '<code>CLAUDE.md</code> and `.claude/rules/security.md`',
      ),
    ).toEqual(['.claude/rules', 'CLAUDE.md']);
    expect(
      extractInstructionPaths(getAgentProfile('codex')!, `<code>${'a'.repeat(241)}</code>`),
    ).toEqual([]);
  });

  it('builds a hashed, revision-bound envelope with stable fact-level diffs', () => {
    const base = getAgentProfile('codex')!;
    const candidate = structuredClone(base);
    candidate.facts.instructionArtifacts.push({
      ...structuredClone(candidate.facts.instructionArtifacts[0]!),
      factId: 'instruction-project-agents-override-md',
      value: { ...candidate.facts.instructionArtifacts[0]!.value, path: 'AGENTS.override.md' },
    });
    const envelope = buildCandidateEnvelope(
      base,
      candidate,
      ['source@sha256:x'],
      '2026-08-15T00:00:00Z',
      ['found'],
      [],
    );
    expect(envelope.basedOnProfileRevision).toBe(base.profileRevision);
    expect(envelope.baseProfileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(envelope.candidateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(envelope.semanticDiff).toMatchObject([
      { operation: 'add', factId: 'instruction-project-agents-override-md' },
    ]);
  });

  it('diffs all mkt4 fact areas and every semantic field stably', () => {
    const base = getAgentProfile('claude-code')!;
    const candidate = structuredClone(base);
    const setting = candidate.facts.settings[0]!;
    setting.confidence = setting.confidence === 'verified' ? 'inferred' : 'verified';
    setting.applicability = { ...setting.applicability, platforms: ['linux'] };
    setting.evidence[0]!.contentHash = `sha256:${'b'.repeat(64)}`;
    candidate.facts.tools.pop();
    const diff = semanticProfileDiff(base, candidate);
    expect(diff.some((item) => item.area === 'settings' && item.operation === 'change')).toBe(true);
    expect(diff.some((item) => item.area === 'tools' && item.operation === 'remove')).toBe(true);
    expect(diff).toEqual(
      [...diff].sort((a, b) => `${a.area}\0${a.factId}`.localeCompare(`${b.area}\0${b.factId}`)),
    );
  });

  it('writes an envelope/evidence only outside canonical files', async () => {
    const root = temp();
    const canonicalBefore = serializeAgentProfiles();
    const fetch = vi.fn(async () =>
      response('<code>AGENTS.md</code><code>AGENTS.override.md</code>'),
    );
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: path.join(root, 'cache'),
      candidateDir: path.join(root, 'candidates'),
      fetch,
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    expect(result.status).toBe('drift');
    const envelope = JSON.parse(fs.readFileSync(result.candidatePath!, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      profileId: 'codex',
      validation: { valid: true },
    });
    expect(serializeAgentProfiles()).toBe(canonicalBefore);
    expect(result.evidence.every((item) => fs.existsSync(item.cachePath))).toBe(true);
  });

  it('keeps daily metadata-only checks behaviorally separate from extraction and diff', async () => {
    const root = temp();
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: path.join(root, 'cache'),
      candidateDir: path.join(root, 'candidates'),
      metadataOnly: true,
      cadence: 'daily',
      fetch: async () => response('<code>AGENTS.override.md</code>'),
      resolveHost: publicDns,
    });
    expect(result).toMatchObject({ status: 'clean', changes: [] });
    expect(result.evidence.map((item) => item.sourceId)).toEqual(['codex-product-docs']);
    expect(result.candidatePath).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'candidates'))).toBe(false);
  });

  it('selects volatile sources weekly and all sources monthly by canonical source id', async () => {
    const weekly = await auditAgentProfile({
      profileId: 'codex',
      cadence: 'weekly',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => response('volatile product documentation'),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    expect(weekly.evidence.map((item) => item.sourceId)).toEqual(['codex-product-docs']);
    expect(weekly).toMatchObject({
      status: 'drift',
      changes: ['source-change:codex-product-docs:manual-extraction-required'],
    });
    const envelope = JSON.parse(fs.readFileSync(weekly.candidatePath!, 'utf8')) as {
      sourceChanges: Array<{ sourceId: string; requiresManualExtraction: boolean }>;
      extraction: { uncertainties: string[] };
      profile: {
        sources: Array<{
          id: string;
          latestSuccessfulRetrieval?: unknown;
          freshness: { status: string };
        }>;
      };
    };
    expect(envelope.sourceChanges).toEqual([
      expect.objectContaining({ sourceId: 'codex-product-docs', requiresManualExtraction: true }),
    ]);
    expect(
      envelope.profile.sources.find((source) => source.id === 'codex-product-docs'),
    ).toMatchObject({
      latestSuccessfulRetrieval: expect.any(Object),
      freshness: { status: 'fresh' },
    });
    expect(envelope.extraction.uncertainties.join(' ')).toContain('manual extraction required');

    const monthly = await auditAgentProfile({
      profileId: 'codex',
      cadence: 'monthly',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => response('<code>AGENTS.md</code>'),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    expect(monthly.evidence.map((item) => item.sourceId).sort()).toEqual([
      'codex-instruction-docs',
      'codex-product-docs',
    ]);
  });

  it('honors an exact manual source selector regardless of cadence', async () => {
    const selected = await auditAgentProfile({
      profileId: 'codex',
      cadence: 'weekly',
      sourceIds: ['codex-instruction-docs'],
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => response('<code>AGENTS.md</code>'),
      resolveHost: publicDns,
    });
    expect(selected.evidence.map((item) => item.sourceId)).toEqual(['codex-instruction-docs']);
  });

  it('keeps unresolved source drift against canonical state across a cached 304', async () => {
    const cacheDir = temp();
    const first = await auditAgentProfile({
      profileId: 'codex',
      cadence: 'weekly',
      cacheDir,
      candidateDir: temp(),
      fetch: async () => response('same volatile body', 200, { etag: 'v1' }),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    const second = await auditAgentProfile({
      profileId: 'codex',
      cadence: 'weekly',
      cacheDir,
      candidateDir: temp(),
      fetch: async () => response('', 304),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:01Z'),
    });
    for (const result of [first, second]) {
      expect(result).toMatchObject({
        status: 'drift',
        changes: ['source-change:codex-product-docs:manual-extraction-required'],
      });
      const envelope = JSON.parse(fs.readFileSync(result.candidatePath!, 'utf8')) as {
        sourceChanges: Array<{ beforeContentHash?: string; afterContentHash: string }>;
      };
      expect(envelope.sourceChanges[0]!.beforeContentHash).toBeUndefined();
    }
    expect(second.evidence[0]!.contentHash).toBe(first.evidence[0]!.contentHash);
  });

  it('marks a selected optional-source failure unresolved without escalating transport status', async () => {
    const result = await auditAgentProfile({
      profileId: 'codex',
      sourceIds: ['codex-product-docs'],
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => {
        throw new Error('optional offline');
      },
      resolveHost: publicDns,
    });
    expect(result).toMatchObject({ status: 'clean', unresolvedSourceIds: ['codex-product-docs'] });
  });
});

describe('profile audit network/cache defenses', () => {
  it('rejects source selectors outside the canonical fetchable allowlist', async () => {
    const result = await auditAgentProfile({
      profileId: 'codex',
      sourceIds: ['not-a-canonical-source'],
    });
    expect(result).toMatchObject({
      status: 'invalid',
      errors: ['unknown or non-fetchable source: not-a-canonical-source'],
      evidence: [],
    });
  });

  it('requires exact source allowlisting and rejects private DNS before transport', async () => {
    const profile = getAgentProfile('codex')!;
    expect(() =>
      assertAllowlistedProfileSource(profile, {
        ...profile.sources[0]!,
        url: 'https://127.0.0.1/',
      }),
    ).toThrow(/allowlist/);
    const fetch = vi.fn(async () => response('x'));
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch,
      resolveHost: async () => ['127.0.0.1'],
    });
    expect(result.status).toBe('fetch-failure');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pins each request and revalidates every redirect resolution', async () => {
    const addresses = [['93.184.216.34'], ['10.0.0.1']];
    const pinned: Array<string | undefined> = [];
    const fetch: HttpFetch = vi.fn(async (_url, init) => {
      pinned.push(init.resolvedAddress);
      return response('', 302, {
        location: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      });
    });
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch,
      resolveHost: async () => addresses.shift() ?? ['10.0.0.1'],
    });
    expect(result.status).toBe('fetch-failure');
    expect(pinned[0]).toBe('93.184.216.34');
  });

  it('accepts the exact current official Codex and Claude redirect chains', async () => {
    const codexFetch: HttpFetch = async (url) => {
      if (url === 'https://developers.openai.com/codex/guides/agents-md')
        return response('', 301, {
          location: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
        });
      if (url === 'https://developers.openai.com/codex/')
        return response('', 302, { location: 'https://learn.chatgpt.com/docs' });
      return response('<code>AGENTS.md</code>');
    };
    expect(
      (
        await auditAgentProfile({
          profileId: 'codex',
          cacheDir: temp(),
          candidateDir: temp(),
          fetch: codexFetch,
          resolveHost: publicDns,
          now: () => new Date('2026-08-15T00:00:00Z'),
        })
      ).status,
    ).toBe('drift');
    const claudeFetch: HttpFetch = async (url) => {
      if (url === 'https://docs.anthropic.com/en/docs/claude-code/memory')
        return response('', 301, { location: 'https://code.claude.com/docs/en/memory' });
      return response('<code>CLAUDE.md</code>');
    };
    expect(
      (
        await auditAgentProfile({
          profileId: 'claude-code',
          cacheDir: temp(),
          candidateDir: temp(),
          fetch: claudeFetch,
          resolveHost: publicDns,
          now: () => new Date('2026-08-15T00:00:00Z'),
        })
      ).status,
    ).toBe('drift');
  });

  it('keeps optional source failures as diagnostics', async () => {
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async (url) => {
        if (url === 'https://developers.openai.com/codex/guides/agents-md')
          return response('<code>AGENTS.md</code>');
        throw new Error('optional offline');
      },
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    expect(result.status).toBe('drift');
    expect(result.errors).toEqual([]);
    expect(result.diagnostics?.join(' ')).toContain('optional source unavailable');
  });

  it('enforces body caps and redirect allowlists/counts', async () => {
    const oversized = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      maxBytes: 2,
      fetch: async () => response('three'),
      resolveHost: publicDns,
    });
    expect(oversized.status).toBe('fetch-failure');
    const redirected = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => response('', 302, { location: 'https://example.com/' }),
      resolveHost: publicDns,
    });
    expect(redirected.status).toBe('fetch-failure');
    let loops = 0;
    const looped = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async (url) => {
        loops += 1;
        return response('', 308, { location: url });
      },
      resolveHost: publicDns,
    });
    expect(looped.status).toBe('fetch-failure');
    expect(loops).toBeGreaterThanOrEqual(4);
    const malformed = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          yield new Uint8Array([0xc3, 0x28]);
        })(),
        text: async () => '',
      }),
      resolveHost: publicDns,
    });
    expect(malformed.status).toBe('fetch-failure');
  });

  it('uses 304 cached bytes and rejects a corrupt content-addressed cache', async () => {
    const root = temp();
    const first = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: root,
      candidateDir: temp(),
      fetch: async () => response('<code>AGENTS.md</code>', 200, { etag: 'v1' }),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
    });
    expect(first.status).toBe('drift');
    const cached = first.evidence[0]!.cachePath;
    const second = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: root,
      candidateDir: temp(),
      fetch: async () => response('', 304),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:01Z'),
    });
    expect(second.status).toBe('drift');
    fs.writeFileSync(cached, 'corrupt');
    const corrupt = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: root,
      candidateDir: temp(),
      fetch: async () => response('', 304),
      resolveHost: publicDns,
    });
    expect(corrupt.status).toBe('fetch-failure');
  });

  it('maps unknown profiles to invalid and retrieval errors to fetch-failure', async () => {
    expect((await auditAgentProfile({ profileId: 'missing' })).status).toBe('invalid');
    const failed = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => {
        throw new Error('offline');
      },
      resolveHost: publicDns,
    });
    expect(failed.status).toBe('fetch-failure');
  });

  it('aborts a transport that exceeds the timeout', async () => {
    const fetch: HttpFetch = async (_url, init) =>
      await new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch,
      resolveHost: publicDns,
      timeoutMs: 5,
    });
    expect(result.status).toBe('fetch-failure');
    expect(result.errors.join(' ')).toMatch(/aborted/);
  });

  it('semantic diff ignores evidence-only refreshes', () => {
    const profile = getAgentProfile('claude-code')!;
    const candidate = structuredClone(profile);
    candidate.facts.instructionArtifacts[0]!.evidence[0]!.checkedAt = '2026-08-15T00:00:00Z';
    expect(semanticProfileDiff(profile, candidate)).toEqual([]);
  });

  it('fails closed when Codex assistance is requested without an isolated runner', async () => {
    const result = await auditAgentProfile({
      profileId: 'codex',
      cacheDir: temp(),
      candidateDir: temp(),
      fetch: async () => response('<code>AGENTS.md</code>'),
      resolveHost: publicDns,
      now: () => new Date('2026-08-15T00:00:00Z'),
      codexAssisted: true,
    });
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain(
      'Codex-assisted extraction unavailable: no verified isolated runner',
    );
  });
});
