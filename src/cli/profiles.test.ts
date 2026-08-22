import { describe, expect, it } from 'vitest';
import { runProfilesAudit, runProfilesList, runProfilesShow } from './profiles.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    value: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) },
  };
}

describe('profiles CLI helpers', () => {
  it('lists profiles and shows one canonical profile', () => {
    const list = io();
    expect(runProfilesList(list.value)).toBe(0);
    expect(JSON.parse(list.out.join('')).some((item: { id: string }) => item.id === 'codex')).toBe(
      true,
    );
    const show = io();
    expect(runProfilesShow('codex', show.value)).toBe(0);
    const shown = JSON.parse(show.out.join(''));
    expect(shown.id).toBe('codex');
    expect(shown.promotion).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain('contentHash');
  });

  it('reports unknown profiles only on stderr', () => {
    const target = io();
    expect(runProfilesShow('missing', target.value)).toBe(1);
    expect(target.out).toEqual([]);
    expect(target.err.join('')).toContain('unknown profile');
  });

  it('maps every audit status and supports --all', async () => {
    for (const [status, expected] of [
      ['clean', 0],
      ['drift', 1],
      ['fetch-failure', 2],
      ['invalid', 3],
    ] as const) {
      const target = io();
      expect(
        await runProfilesAudit('codex', {}, target.value, async ({ profileId }) => ({
          profileId,
          status,
          changes: [],
          errors: [],
          evidence: [],
        })),
      ).toBe(expected);
    }
    const all = io();
    const calls: string[] = [];
    expect(
      await runProfilesAudit(undefined, { all: true }, all.value, async ({ profileId }) => {
        calls.push(profileId);
        return { profileId, status: 'clean', changes: [], errors: [], evidence: [] };
      }),
    ).toBe(0);
    expect(calls.length).toBeGreaterThan(2);
    expect(JSON.parse(all.out.join(''))).toHaveLength(calls.length);
  });

  it('prints only the public audit projection', async () => {
    const target = io();
    await runProfilesAudit('codex', {}, target.value, async () => ({
      profileId: 'codex',
      status: 'fetch-failure',
      candidatePath: '/private/candidate.json',
      changes: ['change:settings:key'],
      errors: ['codex-product-docs: secret internal transport detail'],
      diagnostics: ['model prompt and output'],
      unresolvedSourceIds: ['codex-product-docs'],
      evidence: [
        {
          sourceId: 'codex-product-docs',
          url: 'https://example.com',
          contentHash: `sha256:${'a'.repeat(64)}`,
          cachePath: '/private/cache',
        },
      ],
    }));
    const wire = target.out.join('');
    expect(JSON.parse(wire)).toEqual({
      profileId: 'codex',
      status: 'fetch-failure',
      sourceIds: ['codex-product-docs'],
      unresolvedSourceIds: ['codex-product-docs'],
      changes: ['change:settings:key'],
      errorCategories: ['source-unavailable'],
    });
    for (const forbidden of ['/private', 'sha256:', 'prompt', 'transport detail'])
      expect(wire).not.toContain(forbidden);
  });

  it('requires an id or --all', async () => {
    const target = io();
    expect(await runProfilesAudit(undefined, {}, target.value)).toBe(64);
    expect(target.err.join('')).toContain('--all');
  });

  it('passes the explicit Codex-assisted opt-in without constructing an unsafe runner', async () => {
    const target = io();
    let received: boolean | undefined;
    await runProfilesAudit('codex', { codexAssisted: true }, target.value, async (options) => {
      received = options.codexAssisted;
      expect(options.codexRunner).toBeUndefined();
      return { profileId: 'codex', status: 'clean', changes: [], errors: [], evidence: [] };
    });
    expect(received).toBe(true);
  });
});
