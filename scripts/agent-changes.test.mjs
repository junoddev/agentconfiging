import { describe, expect, it } from 'vitest';
import { agentChanges } from '../site/src/data/agent-changes.ts';

describe('public agent changelog', () => {
  it('is stable, newest-first, unique, and free of internal audit material', () => {
    expect(agentChanges.length).toBeGreaterThan(0);
    expect(new Set(agentChanges.map((change) => change.id)).size).toBe(agentChanges.length);
    expect(agentChanges.map((change) => change.observedAt)).toEqual(
      [...agentChanges.map((change) => change.observedAt)].sort().reverse(),
    );
    for (const change of agentChanges) {
      expect(new Date(change.observedAt).toISOString().replace('.000Z', 'Z')).toBe(
        change.observedAt,
      );
      expect(change.sourceUrl).toMatch(/^https:\/\//);
    }
    expect(JSON.stringify(agentChanges)).not.toMatch(
      /contentHash|candidateHash|cachePath|diagnostics|sha256:/,
    );
  });
});
