/**
 * computeContextCost — pure per-agent initial-context token breakdown
 * (agentconfig-ub3.2). It consumes only the scanned Manifest plus detected
 * agents. No filesystem reads happen here; missing/withheld file content uses
 * the retained manifest size as a safe fallback estimate.
 */

import { dirPrefix } from '../detectors/shared.js';
import type { DetectedAgent } from '../detectors/types.js';
import type { Manifest, ManifestFile } from '../manifest.js';
import { estimateTokens, estimateTokensFromSizeBytes } from '../token-estimate.js';
import type {
  AgentContextCost,
  BudgetStatus,
  ContextCategory,
  ContextCost,
  ContextCostCategory,
  ContextCostFile,
} from './types.js';

/** Launch-time initial-context token budget used by the web tile contract. */
export const CONTEXT_COST_BUDGET_TOKENS = 100_000;

/** Fraction of the token budget at which the status flips ok -> warn. */
const WARN_RATIO = 0.75;

/** Stable order for category tie-breaks. Must match ContextCategory. */
const CATEGORY_ORDER: readonly ContextCategory[] = [
  'instructions',
  'settings',
  'rules',
  'memory',
  'skills',
  'subagents',
  'commands',
  'mcp',
];

/** Root instruction guides that can load into an agent's initial context. */
const ROOT_INSTRUCTION_GUIDES: ReadonlySet<string> = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'COPILOT.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]);

export interface ContextCostOptions {
  /** Per-agent token budget. Defaults to {@link CONTEXT_COST_BUDGET_TOKENS}. */
  budgetTokens?: number;
  /** Optional runtime-specific estimate multiplier, keyed by DetectedAgent.kind. */
  runtimeFudgeFactors?: Readonly<Record<string, number>>;
}

function isOneOf(path: string, values: readonly string[]): boolean {
  return values.includes(path);
}

function statusFor(ratio: number): BudgetStatus {
  if (ratio > 1) return 'over';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'ok';
}

/**
 * Classify a detected-agent file into the shared context categories used by
 * the existing context-health/web contract. Runtime state such as hooks,
 * statusline scripts, logs, and keybindings returns null.
 */
function categoryOfAgentFile(manifest: Manifest, filePath: string): ContextCategory | null {
  if (ROOT_INSTRUCTION_GUIDES.has(filePath)) return 'instructions';
  if (filePath === '.mcp.json') return 'mcp';
  if (filePath.startsWith('.github/instructions/') && filePath.endsWith('.instructions.md')) {
    return 'rules';
  }
  if (filePath.startsWith('.github/copilot/')) return 'settings';
  if (filePath === '.continuerules') return 'rules';
  if (filePath === '.aider.conf.yml' || filePath === '.aiderignore') return 'settings';

  const claude = dirPrefix(manifest, '.claude');
  if (isOneOf(filePath, [`${claude}settings.json`, `${claude}settings.local.json`])) {
    return 'settings';
  }
  if (filePath.startsWith(`${claude}rules/`) && filePath.endsWith('.md')) return 'rules';
  if (filePath.startsWith(`${claude}memory/`)) return 'memory';
  if (filePath.startsWith(`${claude}skills/`)) return 'skills';
  if (filePath.startsWith(`${claude}agents/`) && filePath.endsWith('.md')) return 'subagents';
  if (filePath.startsWith(`${claude}commands/`) && filePath.endsWith('.md')) return 'commands';

  if (filePath.startsWith('.cursor/rules/') && filePath.endsWith('.mdc')) return 'rules';

  const codex = dirPrefix(manifest, '.codex');
  const codexConfigPaths =
    codex === '' ? ['config.toml', 'codex.toml'] : [`${codex}config.toml`, 'codex.toml'];
  if (isOneOf(filePath, codexConfigPaths)) return 'settings';
  if (filePath.startsWith(`${codex}rules/`)) return 'rules';

  const gemini = dirPrefix(manifest, '.gemini');
  if (filePath.startsWith(`${gemini}settings`) || filePath.startsWith(`${gemini}config`)) {
    return 'settings';
  }

  const cont = dirPrefix(manifest, '.continue');
  if (
    isOneOf(filePath, [
      `${cont}config.json`,
      `${cont}config.yaml`,
      `${cont}config.yml`,
      `${cont}config.ts`,
    ])
  ) {
    return 'settings';
  }
  if (filePath.startsWith(`${cont}rules/`)) return 'rules';

  const opencode = dirPrefix(manifest, '.opencode');
  if (filePath === 'opencode.json') return 'settings';
  if (filePath.startsWith(`${opencode}agent/`) && filePath.endsWith('.md')) return 'subagents';
  if (filePath.startsWith(`${opencode}command/`) && filePath.endsWith('.md')) return 'commands';

  return null;
}

function compareCategory(a: ContextCostCategory, b: ContextCostCategory): number {
  return (
    b.tokens - a.tokens || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
}

function compareFile(a: ContextCostFile, b: ContextCostFile): number {
  return b.tokens - a.tokens || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function estimateManifestFileTokens(
  manifestFile: ManifestFile,
  runtimeFudgeFactor: number | undefined,
): number {
  const options = { runtimeFudgeFactor };
  if (typeof manifestFile.content === 'string')
    return estimateTokens(manifestFile.content, options);
  return estimateTokensFromSizeBytes(manifestFile.size, options);
}

function costForAgent(
  manifest: Manifest,
  filesByPath: ReadonlyMap<string, ManifestFile>,
  agent: DetectedAgent,
  opts: Required<Pick<ContextCostOptions, 'budgetTokens'>> & ContextCostOptions,
): AgentContextCost {
  const files: ContextCostFile[] = [];
  const byCategory = new Map<ContextCategory, ContextCostCategory>();
  let totalTokens = 0;
  const runtimeFudgeFactor = opts.runtimeFudgeFactors?.[agent.kind];

  for (const filePath of [...new Set(agent.files)].sort()) {
    const manifestFile = filesByPath.get(filePath);
    if (!manifestFile) continue;
    const category = categoryOfAgentFile(manifest, filePath);
    if (!category) continue;

    const tokens = estimateManifestFileTokens(manifestFile, runtimeFudgeFactor);
    files.push({ path: filePath, tokens, category });
    totalTokens += tokens;
    const cur = byCategory.get(category) ?? { category, tokens: 0, files: 0 };
    cur.tokens += tokens;
    cur.files += 1;
    byCategory.set(category, cur);
  }

  files.sort(compareFile);
  const budgetRatio = totalTokens / opts.budgetTokens;

  return {
    kind: agent.kind,
    totalTokens,
    budgetTokens: opts.budgetTokens,
    budgetRatio,
    status: statusFor(budgetRatio),
    byCategory: [...byCategory.values()].sort(compareCategory),
    files,
  };
}

/**
 * Compute the per-agent token estimate for initial context. Shared files count
 * once per agent that owns them; duplicate paths inside one agent count once.
 */
export function computeContextCost(
  manifest: Manifest,
  agents: readonly DetectedAgent[],
  opts: ContextCostOptions = {},
): ContextCost {
  const budgetTokens = opts.budgetTokens ?? CONTEXT_COST_BUDGET_TOKENS;
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) {
    throw new RangeError('budgetTokens must be a finite number greater than 0');
  }

  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const fullOpts = { ...opts, budgetTokens };
  const costs = agents
    .map((agent) => costForAgent(manifest, filesByPath, agent, fullOpts))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  return { budgetTokens, agents: costs };
}
