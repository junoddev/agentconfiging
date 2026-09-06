/**
 * Context-health types (SPEC §5 row 16 / E7, bead agentconfig-7yb.6).
 *
 * A pure, content-free view over a scanned Manifest: how much of the agent
 * config FOOTPRINT gets loaded into an agent's context window, which files
 * contribute most, how the total sits against a budget, and honest,
 * size-derived optimization suggestions. Numbers + paths + messages only —
 * never a file body.
 */

/** The kinds of context-loaded agent config a manifest file can belong to. */
export type ContextCategory =
  'instructions' | 'settings' | 'rules' | 'memory' | 'skills' | 'subagents' | 'commands' | 'mcp';

/** One context-loaded config file: its path, byte size, and category. */
export interface ContextFile {
  path: string;
  size: number;
  category: ContextCategory;
}

/** Aggregate byte/file total for one category. */
export interface CategoryTotal {
  category: ContextCategory;
  bytes: number;
  files: number;
}

/** How to weight a suggestion in the UI. */
export type SuggestionSeverity = 'warn' | 'info';

/** One data-driven optimization suggestion. `message` is derived purely from
 *  manifest sizes/counts — never fabricated. */
export interface ContextSuggestion {
  id: string;
  severity: SuggestionSeverity;
  message: string;
}

/** Budget verdict: within, nearing, or over the ceiling. */
export type BudgetStatus = 'ok' | 'warn' | 'over';

/** The complete, content-free context-health result over a Manifest. */
export interface ContextHealth {
  /** Total bytes of context-loaded config across every category. */
  totalBytes: number;
  /** Number of context-loaded config files counted. */
  fileCount: number;
  /** The size budget (bytes) the total is measured against. */
  budgetBytes: number;
  /** totalBytes / budgetBytes — can exceed 1. */
  budgetRatio: number;
  /** Verdict derived from the ratio. */
  status: BudgetStatus;
  /** Per-category totals, largest-first. */
  byCategory: CategoryTotal[];
  /** The largest individual contributors, largest-first (path tiebreak). */
  largest: ContextFile[];
  /** Honest, size-derived optimization suggestions (empty when compact). */
  suggestions: ContextSuggestion[];
}

/** One token-estimated file in an agent's initial context. */
export interface ContextCostFile {
  path: string;
  tokens: number;
  category: ContextCategory;
}

/** Token total for one context category inside a detected agent. */
export interface ContextCostCategory {
  category: ContextCategory;
  tokens: number;
  files: number;
}

/** Per-agent initial context token budget breakdown. */
export interface AgentContextCost {
  kind: string;
  totalTokens: number;
  budgetTokens: number;
  budgetRatio: number;
  status: BudgetStatus;
  byCategory: ContextCostCategory[];
  files: ContextCostFile[];
}

/** The complete per-agent context-cost result for an instance. */
export interface ContextCost {
  budgetTokens: number;
  agents: AgentContextCost[];
}
