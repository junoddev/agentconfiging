import { describe, expect, it } from 'vitest';
import { AGENT_PROFILES } from './data.js';
import { validateAgentProfiles } from './validate.js';

describe('agent profile validator robustness', () => {
  it.each([null, undefined, 1, 'profiles', {}, [null], [42]])(
    'returns issues instead of throwing for %j',
    (input) => {
      expect(() => validateAgentProfiles(input)).not.toThrow();
      expect(validateAgentProfiles(input).length).toBeGreaterThan(0);
    },
  );

  it('reports deeply malformed contract fields without throwing', () => {
    const malformed = structuredClone(AGENT_PROFILES[0]!) as unknown as Record<string, unknown>;
    malformed.aliases = 'alias';
    malformed.sources = [{ id: 3, kind: 'blog', required: 'yes', covers: ['bogus'] }];
    malformed.maintainer = null;
    malformed.coverage = [];
    malformed.facts = { instructionArtifacts: [null] };
    malformed.observedProductVersion = 123;
    const issues = validateAgentProfiles([malformed]);
    expect(issues.length).toBeGreaterThan(8);
    expect(issues.map((issue) => issue.path)).toContain('[0].aliases');
    expect(issues.map((issue) => issue.path)).toContain('[0].sources[0].kind');
    expect(issues.map((issue) => issue.path)).toContain('[0].maintainer');
  });

  it('rejects an invalid validation clock without throwing', () => {
    expect(validateAgentProfiles(AGENT_PROFILES, new Date('invalid'))).toEqual([
      { path: '$now', message: 'must be a valid Date' },
    ]);
  });

  it('rejects invalid enums, impossible dates, unsafe paths, and source targets', () => {
    const profile = structuredClone(AGENT_PROFILES[0]!);
    const fact = profile.facts.instructionArtifacts[0]!;
    profile.maintainer.detectionMarkers.push('../escape');
    profile.sources[0]!.command = ['sh', '-c', 'danger'];
    fact.evidence[0]!.checkedAt = '2026-02-30T00:00:00Z';
    fact.applicability.channels = [];
    const messages = validateAgentProfiles([profile], new Date('2026-08-15T00:00:00Z')).map(
      (issue) => issue.message,
    );
    expect(messages).toContain('unsafe detection marker');
    expect(messages).toContain('HTTP source requires only a URL and HTTP retrieval');
    expect(messages).toContain('must be a UTC RFC 3339 timestamp with seconds and Z');
    expect(messages).toContain('applicability lists cannot be empty');

    const invalidShape = structuredClone(AGENT_PROFILES[0]!);
    (invalidShape as { schemaVersion: number }).schemaVersion = 2;
    (invalidShape.coverage as Record<string, string>).models = 'maybe';
    const shapeMessages = validateAgentProfiles([invalidShape]).map((issue) => issue.message);
    expect(shapeMessages).toContain('must equal 1');
    expect(shapeMessages).toContain('has an unsupported value');
  });

  it('rejects duplicate evidence, mixed source schemes, and bad replacement links', () => {
    const profile = structuredClone(AGENT_PROFILES[0]!);
    const fact = profile.facts.instructionArtifacts[0]!;
    profile.sources.push({
      id: 'versioned-schema',
      kind: 'official-schema',
      url: 'https://example.com/schema.json',
      required: false,
      covers: ['instructionArtifacts'],
      versionScheme: 'semver',
      retrievalPolicy: { method: 'http', maxAgeDays: 7 },
      freshness: { status: 'unavailable', reason: 'test fixture' },
    });
    fact.evidence.push(
      { ...fact.evidence[0]! },
      {
        sourceId: 'versioned-schema',
        locator: '/properties/rules',
        checkedAt: '2026-07-26T00:00:00Z',
      },
    );
    fact.replacementFactId = fact.factId;
    const messages = validateAgentProfiles([profile], new Date('2026-08-15T00:00:00Z')).map(
      (issue) => issue.message,
    );
    expect(messages).toContain('evidence must be unique and sorted by sourceId and locator');
    expect(messages).toContain('mixed version schemes are invalid');
    expect(messages).toContain('replacementFactId cannot reference itself');
    expect(messages).toContain('replacementFactId forms a cycle');
  });

  it('detects two-node and cross-profile replacement cycles', () => {
    const left = structuredClone(AGENT_PROFILES[0]!);
    const first = left.facts.instructionArtifacts[0]!;
    const second = structuredClone(first);
    second.factId = `${first.factId}-replacement`;
    first.replacementFactId = second.factId;
    second.replacementFactId = first.factId;
    left.facts.instructionArtifacts.push(second);
    expect(validateAgentProfiles([left]).map((issue) => issue.message)).toContain(
      'replacementFactId forms a cycle',
    );

    const right = structuredClone(AGENT_PROFILES[1]!);
    const leftFact = left.facts.instructionArtifacts[0]!;
    const rightFact = right.facts.instructionArtifacts[0]!;
    left.facts.instructionArtifacts = [leftFact];
    leftFact.replacementFactId = `${right.id}/${rightFact.factId}`;
    rightFact.replacementFactId = `${left.id}/${leftFact.factId}`;
    expect(validateAgentProfiles([left, right]).map((issue) => issue.message)).toContain(
      'replacementFactId forms a cycle',
    );
  });

  it('validates semver and calver grammars and bound ordering', () => {
    const semver = structuredClone(AGENT_PROFILES[0]!);
    semver.sources[0]!.versionScheme = 'semver';
    const semverFact = semver.facts.instructionArtifacts[0]!;
    semverFact.applicability = { since: '2.0', until: '1.0.0' };
    const semverMessages = validateAgentProfiles([semver]).map((issue) => issue.message);
    expect(semverMessages).toContain('invalid semver version');
    expect(semverMessages).toContain('since must not be later than until');

    const calver = structuredClone(AGENT_PROFILES[0]!);
    calver.sources[0]!.versionScheme = 'calver';
    const calverFact = calver.facts.instructionArtifacts[0]!;
    calverFact.applicability = { since: '2026.13.01', until: '2025.12.31' };
    const calverMessages = validateAgentProfiles([calver]).map((issue) => issue.message);
    expect(calverMessages).toContain('invalid calver version');
    expect(calverMessages).toContain('since must not be later than until');
  });
});
