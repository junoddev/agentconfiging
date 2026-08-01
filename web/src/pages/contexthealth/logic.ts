/**
 * ContextHealth page pure logic (bead 7yb.6). DOM-free, unit-tested. Maps the
 * content-free context-health view to display strings + meter levels.
 */

import type {
  AgentContextCost,
  BudgetStatus,
  ContextCategory,
  ContextCost,
  ContextHealth,
} from '../../api/index.js';

/** Human label for a category (mono micro-label copy). */
export function categoryLabel(category: ContextCategory): string {
  switch (category) {
    case 'instructions':
      return 'INSTRUCTIONS';
    case 'settings':
      return 'SETTINGS';
    case 'rules':
      return 'RULES';
    case 'memory':
      return 'MEMORY';
    case 'skills':
      return 'SKILLS';
    case 'subagents':
      return 'SUBAGENTS';
    case 'commands':
      return 'COMMANDS';
    case 'mcp':
      return 'MCP';
  }
}

/** Short verdict caption for the budget meter. */
export function statusLabel(status: BudgetStatus): string {
  switch (status) {
    case 'ok':
      return 'within budget';
    case 'warn':
      return 'nearing budget';
    case 'over':
      return 'over budget';
  }
}

/** Meter fill for the budget bar — the ratio clamped into [0, 1]. */
export function meterLevel(health: ContextHealth): number {
  return Math.min(1, Math.max(0, health.budgetRatio));
}

/** Budget usage as a whole-percent string, e.g. "16%". */
export function budgetPercent(health: ContextHealth): string {
  return `${Math.round(health.budgetRatio * 100)}%`;
}

/** Token count display for compact stat tiles. */
export function formatTokenCount(tokens: number): string {
  return Math.round(tokens).toLocaleString('en-US');
}

/** Token budget usage as a whole-percent string, e.g. "16%". */
export function tokenPercent(agent: AgentContextCost): string {
  return `${Math.round(agent.budgetRatio * 100)}%`;
}

/** Compact caption for a per-agent initial-context tile. */
export function agentCostCaption(agent: AgentContextCost): string {
  return `${formatTokenCount(agent.budgetTokens)} budget · ${tokenPercent(agent)} · ${statusLabel(
    agent.status,
  )}`;
}

/** True when the instance carries no context-loaded config at all. */
export function hasNoConfig(health: ContextHealth): boolean {
  return health.fileCount === 0;
}

/** True when no detected agent has an initial-context token breakdown. */
export function hasNoContextCost(cost: ContextCost): boolean {
  return cost.agents.length === 0;
}
