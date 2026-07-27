import { describe, expect, it } from 'vitest';
import type { ContextHealth } from '../../api/index.js';
import { budgetPercent, categoryLabel, hasNoConfig, meterLevel, statusLabel } from './logic.js';

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

  it('detects an empty config', () => {
    expect(hasNoConfig(health({ fileCount: 0 }))).toBe(true);
    expect(hasNoConfig(health({ fileCount: 3 }))).toBe(false);
  });
});
