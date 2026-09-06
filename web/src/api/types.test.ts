import { describe, expect, it } from 'vitest';
import {
  isGlobalEntryError,
  type ContextCost,
  type GlobalEntry,
  type GlobalEntryError,
} from './types.js';

const ENTRY: GlobalEntry = {
  root: '/home/u/.claude',
  dir: '.claude',
  agents: [],
  quality: {
    score: 100,
    components: [],
    metrics: {
      totalTokens: 0,
      guideCount: 0,
      directiveCount: 0,
      criticalRuleCount: 0,
      buriedCriticalRuleCount: 0,
      contradictionCount: 0,
    },
  },
  findings: [],
  stats: { fileCount: 0, totalBytes: 0 },
};

const ERROR_ENTRY: GlobalEntryError = {
  root: '/home/u/.cursor',
  dir: '.cursor',
  error: { name: 'Error', code: 'EACCES', message: 'permission denied' },
};

describe('isGlobalEntryError', () => {
  it('narrows the error variant', () => {
    expect(isGlobalEntryError(ERROR_ENTRY)).toBe(true);
  });

  it('rejects a successful entry', () => {
    expect(isGlobalEntryError(ENTRY)).toBe(false);
  });
});

describe('ContextCost wire type', () => {
  it('accepts the expected ub3.2 per-agent initial-context shape', () => {
    const cost = {
      budgetTokens: 100000,
      agents: [
        {
          kind: 'claude-code',
          totalTokens: 1200,
          budgetTokens: 100000,
          budgetRatio: 0.012,
          status: 'ok',
          byCategory: [{ category: 'instructions', tokens: 950, files: 2 }],
          files: [{ path: 'CLAUDE.md', tokens: 950, category: 'instructions' }],
        },
      ],
    } satisfies ContextCost;

    expect(cost.agents[0]?.kind).toBe('claude-code');
    expect(cost.agents[0]?.byCategory?.[0]?.tokens).toBe(950);
  });
});
