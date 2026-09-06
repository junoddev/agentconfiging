import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ReportStore } from './store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-store-'));
fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Guide\n\n- Always run tests.\n');

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ReportStore context-cost cache', () => {
  it('keys sequential calls by normalized effective options', () => {
    const store = new ReportStore(root, '1.0.0');

    const smallBudget = store.contextCost('project', { budgetTokens: 10 });
    const largeBudget = store.contextCost('project', { budgetTokens: 1_000 });
    const doubled = store.contextCost('project', {
      budgetTokens: 1_000,
      runtimeFudgeFactors: { codex: 2, unused: 1 },
    });
    const reordered = store.contextCost('project', {
      runtimeFudgeFactors: { unused: 1, codex: 2 },
      budgetTokens: 1_000,
    });

    expect(smallBudget.budgetTokens).toBe(10);
    expect(largeBudget.budgetTokens).toBe(1_000);
    expect(doubled.agents[0]?.totalTokens).toBeGreaterThan(largeBudget.agents[0]?.totalTokens ?? 0);
    expect(reordered).toBe(doubled);
  });

  it('treats omitted and explicit default budget as the same effective cache entry', () => {
    const store = new ReportStore(root, '1.0.0');
    const implicit = store.contextCost('project');
    const explicit = store.contextCost('project', { budgetTokens: 100_000 });

    expect(explicit).toBe(implicit);
  });
});
