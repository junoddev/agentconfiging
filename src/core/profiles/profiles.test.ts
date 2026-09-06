import { describe, expect, it } from 'vitest';
import { BASELINE_RUNTIME_FORMATS } from './baseline.js';
import { RUNTIME_FORMATS } from '../runtimes/table.js';
import {
  AGENT_PROFILES,
  CLAUDE_CATALOG,
  CLAUDE_PUBLIC_CATALOG,
  getAgentProfile,
  serializeAgentProfiles,
  validateAgentProfiles,
} from './index.js';

describe('agent profile registry', () => {
  it('contains a valid deterministic profile for every runtime', () => {
    expect(validateAgentProfiles(AGENT_PROFILES, new Date('2026-08-23T13:00:00Z'))).toEqual([]);
    expect(AGENT_PROFILES.map((profile) => profile.id)).toEqual(
      BASELINE_RUNTIME_FORMATS.map((runtime) => runtime.id).sort(),
    );
    expect(serializeAgentProfiles()).toBe(serializeAgentProfiles([...AGENT_PROFILES].reverse()));
    const reordered = structuredClone(AGENT_PROFILES);
    reordered[0]!.sources.reverse();
    reordered[0]!.maintainer.detectionMarkers.reverse();
    reordered[0]!.facts.instructionArtifacts[0]!.evidence.reverse();
    expect(serializeAgentProfiles(reordered)).toBe(serializeAgentProfiles());
  });

  it('seeds the runtime table without losing instruction or scaffold data', () => {
    for (const runtime of BASELINE_RUNTIME_FORMATS) {
      const profile = getAgentProfile(runtime.id);
      expect(profile).toBeDefined();
      expect(profile?.displayName).toBe(runtime.displayName);
      expect(profile?.maintainer.scaffoldPath).toBe(runtime.scaffoldPath);
      expect(profile?.maintainer.scaffoldTemplate).toBe(runtime.scaffoldTemplate);
      expect(profile?.maintainer.detectionMarkers).toEqual(runtime.detectionMarkers);
      if (!['claude-code', 'codex'].includes(runtime.id))
        expect(profile?.promotion).toMatchObject({
          method: 'baseline-import',
          provenance: 'src/core/profiles/baseline.ts',
        });
      const artifacts = profile?.facts.instructionArtifacts.map((fact) => fact.value);
      expect(
        artifacts?.filter((value) => value.scope === 'project').map((value) => value.path),
      ).toEqual(expect.arrayContaining(runtime.instructionPaths));
      expect(
        artifacts?.filter((value) => value.scope === 'global').map((value) => value.path),
      ).toEqual(expect.arrayContaining(runtime.globalPaths ?? []));
      for (const artifact of artifacts ?? []) {
        expect(artifact.format).toBe(runtime.format);
        if ([...runtime.instructionPaths, ...(runtime.globalPaths ?? [])].includes(artifact.path)) {
          expect(artifact.layout).toBe(runtime.layout);
          expect(artifact.loadBehavior).toBe(runtime.scopeNotes);
        }
      }
      expect(profile?.sources.some((source) => source.url === runtime.docsUrl)).toBe(true);
    }
  });

  it('loads reviewed promotions with approval provenance and new instruction artifacts', () => {
    const claude = getAgentProfile('claude-code')!;
    const codex = getAgentProfile('codex')!;
    for (const profile of [claude, codex]) {
      expect(profile.profileRevision).toBe(2);
      expect(profile.promotion).toMatchObject({
        method: 'reviewed-candidate',
        basedOnProfileRevision: 1,
        approvals: [
          expect.objectContaining({
            approverId: 'tranqy',
            decision: 'approve',
            basedOnProfileRevision: 1,
          }),
        ],
      });
    }
    expect(claude.facts.instructionArtifacts.map((fact) => fact.value.path)).toContain(
      '.claude/rules',
    );
    expect(codex.facts.instructionArtifacts.map((fact) => fact.value.path)).toEqual(
      expect.arrayContaining(['~/.codex/AGENTS.override.md', 'AGENTS.override.md']),
    );
  });

  it('projects promoted instruction paths through the RuntimeFormat compatibility surface', () => {
    expect(RUNTIME_FORMATS).toHaveLength(BASELINE_RUNTIME_FORMATS.length);
    expect(
      RUNTIME_FORMATS.find((runtime) => runtime.id === 'claude-code')?.instructionPaths,
    ).toEqual(expect.arrayContaining(['CLAUDE.md', '.claude/rules']));
    expect(RUNTIME_FORMATS.find((runtime) => runtime.id === 'codex')).toMatchObject({
      instructionPaths: expect.arrayContaining(['AGENTS.md', 'AGENTS.override.md']),
      globalPaths: expect.arrayContaining(['~/.codex/AGENTS.md', '~/.codex/AGENTS.override.md']),
    });
  });

  it('keeps dated Claude catalogs as evidenced profile facts and exposes only a safe projection', () => {
    const profile = getAgentProfile('claude-code')!;
    expect(profile.coverage).toMatchObject({
      settings: 'unknown',
      models: 'unknown',
      tools: 'unknown',
      hookEvents: 'unknown',
    });
    expect(profile.facts.settings.map((fact) => (fact.value as { key: string }).key)).toContain(
      'enableAllProjectMcpServers',
    );
    expect(
      profile.facts.models.find(
        (fact) => (fact.value as { id: string }).id === 'claude-3-opus-20240229',
      ),
    ).toMatchObject({
      lifecycle: 'legacy',
      confidence: 'unknown',
      value: { purpose: 'cross-provider-reference-compatibility' },
    });
    expect(
      profile.facts.models.find((fact) => (fact.value as { id: string }).id === 'gpt-4'),
    ).toMatchObject({
      lifecycle: 'legacy',
      confidence: 'unknown',
      value: { purpose: 'cross-provider-reference-compatibility' },
    });
    for (const area of ['settings', 'models', 'tools', 'hookEvents'] as const) {
      for (const fact of profile.facts[area]) {
        expect(fact.evidence).toEqual([
          expect.objectContaining({
            sourceId: 'agentconfig-legacy-claude-catalog',
            checkedAt: '2026-07-26T00:00:00Z',
          }),
        ]);
      }
    }
    expect(
      profile.sources.find((source) => source.id === 'agentconfig-legacy-claude-catalog'),
    ).toMatchObject({
      kind: 'independent-docs',
      required: false,
      freshness: { status: 'unavailable' },
    });
    expect(
      profile.facts.models.some(
        (fact) =>
          (fact.value as { id: string }).id === 'gpt-4' &&
          fact.lifecycle === 'removed' &&
          fact.confidence === 'verified',
      ),
    ).toBe(false);
    expect(CLAUDE_CATALOG).toMatchObject({ checkedAt: '2026-07-26' });
    expect(CLAUDE_CATALOG.tools).toContain('Read');
    expect(CLAUDE_CATALOG.hookEvents.map((event) => event.name)).toContain('PreToolUse');
    expect(CLAUDE_CATALOG.staleModelReplacements['claude-3-opus-20240229']).toBe('claude-opus-4-5');
    expect(CLAUDE_CATALOG).not.toHaveProperty('sources');
    expect(CLAUDE_CATALOG).not.toHaveProperty('evidence');
    expect(CLAUDE_CATALOG).not.toHaveProperty('promotion');
    expect(CLAUDE_PUBLIC_CATALOG).toEqual(CLAUDE_CATALOG);
  });

  it('rejects unsafe and unresolved mutations', () => {
    const profile = structuredClone(AGENT_PROFILES[0]!);
    profile.facts.instructionArtifacts[0]!.value.path = '../escape';
    profile.facts.instructionArtifacts[0]!.replacementFactId = 'missing';
    profile.sources[0]!.url = 'http://example.com';
    const messages = validateAgentProfiles([profile], new Date('2026-08-15T00:00:00Z')).map(
      (issue) => issue.message,
    );
    expect(messages).toContain('unsafe artifact path');
    expect(messages).toContain('replacementFactId does not resolve');
    expect(messages).toContain('must be a valid HTTPS URL');
  });
});
