/**
 * Context-health engine barrel (SPEC §5 row 16 / E7, bead agentconfig-7yb.6).
 * A pure, content-free computation over a scanned Manifest — the size/footprint
 * of the agent config that loads into an agent's context window. A thin server
 * endpoint (context-health route) or the UI calls `computeContextHealth`; no
 * I/O lives here.
 */

export { computeContextHealth, CONTEXT_BUDGET_BYTES } from './context-health.js';
export {
  computeContextCost,
  CONTEXT_COST_BUDGET_TOKENS,
  type ContextCostOptions,
} from './context-cost.js';
export type {
  AgentContextCost,
  BudgetStatus,
  CategoryTotal,
  ContextCategory,
  ContextCost,
  ContextCostCategory,
  ContextCostFile,
  ContextFile,
  ContextHealth,
  ContextSuggestion,
  SuggestionSeverity,
} from './types.js';
