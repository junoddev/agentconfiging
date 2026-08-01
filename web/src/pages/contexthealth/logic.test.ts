import { describe, expect, it } from 'vitest';
import type { AgentContextCost, ContextCost, ContextHealth } from '../../api/index.js';
import {
  agentCostCaption,
  budgetPercent,
  categoryLabel,
  formatTokenCount,
  hasNoConfig,
  hasNoContextCost,
  meterLevel,
  statusLabel,
  tokenPercent,
} from './logic.js';

function health(over: Partial<ContextHealth> = {}): ContextHealth {
  return {
    totalBytes: 8000,
    fileCount: 4,
    budgetBytes: 48 * 1024,
    budgetRatio: 8000 / (48 * 1024),
    status: 'ok',
    byCategory: [],
    largest: [],
    suggestions: [],
    ...over,
  };
}

function agentCost(over: Partial<AgentContextCost> = {}): AgentContextCost {
  return {
    kind: 'claude-code',
    totalTokens: 1200,
    budgetTokens: 100000,
    budgetRatio: 0.012,
    status: 'ok',
    ...over,
  };
}

function cost(over: Partial<ContextCost> = {}): ContextCost {
  return {
    budgetTokens: 100000,
    agents: [agentCost()],
    ...over,
  };
}

describe('contexthealth logic', () => {
  it('labels every category', () => {
    expect(categoryLabel('instructions')).toBe('INSTRUCTIONS');
    expect(categoryLabel('mcp')).toBe('MCP');
    expect(categoryLabel('subagents')).toBe('SUBAGENTS');
  });

  it('captions the budget verdict', () => {
    expect(statusLabel('ok')).toBe('within budget');
    expect(statusLabel('warn')).toBe('nearing budget');
    expect(statusLabel('over')).toBe('over budget');
  });

  it('clamps the meter level to [0,1]', () => {
    expect(meterLevel(health({ budgetRatio: 0.16 }))).toBeCloseTo(0.16);
    expect(meterLevel(health({ budgetRatio: 2.5 }))).toBe(1);
    expect(meterLevel(health({ budgetRatio: -0.1 }))).toBe(0);
  });

  it('renders budget usage as a whole percent', () => {
    expect(budgetPercent(health({ budgetRatio: 0.16 }))).toBe('16%');
    expect(budgetPercent(health({ budgetRatio: 1.2 }))).toBe('120%');
  });

  it('renders token counts and per-agent budget usage', () => {
    expect(formatTokenCount(1200.4)).toBe('1,200');
    expect(tokenPercent(agentCost({ budgetRatio: 0.164 }))).toBe('16%');
    expect(agentCostCaption(agentCost({ budgetRatio: 0.164, status: 'warn' }))).toBe(
      '100,000 budget · 16% · nearing budget',
    );
  });

  it('detects an empty config', () => {
    expect(hasNoConfig(health({ fileCount: 0 }))).toBe(true);
    expect(hasNoConfig(health({ fileCount: 3 }))).toBe(false);
  });

  it('detects an empty per-agent context-cost result', () => {
    expect(hasNoContextCost(cost({ agents: [] }))).toBe(true);
    expect(hasNoContextCost(cost())).toBe(false);
  });
});
