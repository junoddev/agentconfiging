/**
 * computeContextHealth — a PURE, fixture-testable pass over a Manifest (SPEC §5
 * row 16 / E7, bead agentconfig-7yb.6). No I/O; it reads only manifest facts
 * (file paths + byte sizes), never file CONTENT, so the result is content-free
 * and safe to serialize straight to the client.
 *
 * "Context health" = the SIZE/footprint of the agent config that gets loaded
 * into an agent's context window. The always-loaded categories (instructions,
 * rules, memory, settings) compete for the window on every turn; the on-demand
 * categories (skills, subagents, commands, mcp) still count toward the overall
 * config footprint. Pure runtime-state files (hooks scripts, keybindings,
 * statusline) never load into context and are excluded.
 *
 * Scope-aware via `dirPrefix`: a project manifest anchors config under
 * `.claude/`; a global manifest (~/.claude) is rooted at the config dir itself,
 * so the prefix collapses to ''. Root instruction guides + `.mcp.json` sit at
 * the manifest root in either scope.
 */

import { dirPrefix } from '../detectors/shared.js';
import type { Manifest } from '../manifest.js';
import type {
  BudgetStatus,
  CategoryTotal,
  ContextCategory,
  ContextFile,
  ContextHealth,
  ContextSuggestion,
} from './types.js';

/**
 * Budget for the total context-loaded config footprint (bytes). A generous
 * ceiling for a well-kept project: every byte of always-loaded config competes
 * for the agent's context window, and the on-demand categories add to the
 * overall footprint. Exported so the UI can label the meter consistently.
 */
export const CONTEXT_BUDGET_BYTES = 48 * 1024;

/** Fraction of the budget at which the status flips ok → warn. */
const WARN_RATIO = 0.75;

/** How many individual contributors the `largest` list surfaces. */
const TOP_N = 8;

// Suggestion thresholds — all size/count based (never a fabricated metric).
const LARGE_GUIDE_BYTES = 8 * 1024;
const LARGE_SETTINGS_BYTES = 6 * 1024;
const LARGE_RULES_BYTES = 8 * 1024;
const MANY_RULES = 5;
const LARGE_MEMORY_BYTES = 8 * 1024;

/** Root instruction guides that always load into context (mirrors the guide
 *  set in ../report.ts). */
const INSTRUCTION_GUIDES: ReadonlySet<string> = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]);

/** Stable order for tie-breaking equal-byte categories deterministically. */
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

/** Human-readable byte count matching the web `formatBytes` (512 → "512 B"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deterministic id fragment from a path. */
function slug(path: string): string {
  return path.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

/** Classify a manifest path into a context category, or null when it is not
 *  context-loaded config. `prefix` is the scope-aware `.claude/` prefix. */
function categoryOf(path: string, prefix: string): ContextCategory | null {
  if (INSTRUCTION_GUIDES.has(path)) return 'instructions';
  if (path === `${prefix}settings.json` || path === `${prefix}settings.local.json`) {
    return 'settings';
  }
  if (path === '.mcp.json') return 'mcp';
  if (path.startsWith(`${prefix}rules/`) && path.endsWith('.md')) return 'rules';
  if (path.startsWith('.cursor/rules/') && path.endsWith('.mdc')) return 'rules';
  if (path.startsWith(`${prefix}memory/`)) return 'memory';
  if (path.startsWith(`${prefix}skills/`)) return 'skills';
  if (path.startsWith(`${prefix}agents/`) && path.endsWith('.md')) return 'subagents';
  if (path.startsWith(`${prefix}commands/`) && path.endsWith('.md')) return 'commands';
  return null;
}

/** Build the honest, size-derived suggestion list. Ordered deterministically:
 *  the budget verdict first, then per-file/per-category advice. */
function buildSuggestions(
  files: ContextFile[],
  byCategory: Map<ContextCategory, CategoryTotal>,
  totalBytes: number,
  status: BudgetStatus,
): ContextSuggestion[] {
  const out: ContextSuggestion[] = [];

  if (status !== 'ok') {
    out.push({
      id: 'over-budget',
      severity: status === 'over' ? 'warn' : 'info',
      message:
        status === 'over'
          ? `context config totals ${formatBytes(totalBytes)}, over the ${formatBytes(
              CONTEXT_BUDGET_BYTES,
            )} budget — trim the largest contributors below.`
          : `context config totals ${formatBytes(totalBytes)}, nearing the ${formatBytes(
              CONTEXT_BUDGET_BYTES,
            )} budget.`,
    });
  }

  for (const f of files) {
    if (f.category === 'instructions' && f.size > LARGE_GUIDE_BYTES) {
      out.push({
        id: `guide-large-${slug(f.path)}`,
        severity: 'warn',
        message: `${f.path} is ${formatBytes(
          f.size,
        )} — it loads into context on every turn; split it with @imports or trim it.`,
      });
    }
  }

  for (const f of files) {
    if (f.category === 'settings' && f.size > LARGE_SETTINGS_BYTES) {
      out.push({
        id: `settings-large-${slug(f.path)}`,
        severity: 'info',
        message: `${f.path} is ${formatBytes(
          f.size,
        )} — large settings files are harder to review; drop stale keys.`,
      });
    }
  }

  const rules = byCategory.get('rules');
  if (rules && (rules.files >= MANY_RULES || rules.bytes > LARGE_RULES_BYTES)) {
    out.push({
      id: 'rules-heavy',
      severity: 'info',
      message: `${rules.files} rule file${rules.files === 1 ? '' : 's'} total ${formatBytes(
        rules.bytes,
      )} — rules stay in context; consolidate related ones.`,
    });
  }

  const memory = byCategory.get('memory');
  if (memory && memory.bytes > LARGE_MEMORY_BYTES) {
    out.push({
      id: 'memory-heavy',
      severity: 'info',
      message: `memory notes total ${formatBytes(
        memory.bytes,
      )} — prune outdated context to reclaim window.`,
    });
  }

  return out;
}

/**
 * Compute the content-free context-health view for a manifest. Deterministic:
 * categories and contributors come back sorted, suggestions in a fixed order.
 */
export function computeContextHealth(manifest: Manifest): ContextHealth {
  const prefix = dirPrefix(manifest, '.claude');
  const files: ContextFile[] = [];
  const byCategory = new Map<ContextCategory, CategoryTotal>();
  let totalBytes = 0;

  for (const f of manifest.files) {
    const category = categoryOf(f.path, prefix);
    if (!category) continue;
    files.push({ path: f.path, size: f.size, category });
    totalBytes += f.size;
    const cur = byCategory.get(category) ?? { category, bytes: 0, files: 0 };
    cur.bytes += f.size;
    cur.files += 1;
    byCategory.set(category, cur);
  }

  const budgetRatio = totalBytes / CONTEXT_BUDGET_BYTES;
  const status: BudgetStatus = budgetRatio > 1 ? 'over' : budgetRatio >= WARN_RATIO ? 'warn' : 'ok';

  const categoryTotals = [...byCategory.values()].sort(
    (a, b) =>
      b.bytes - a.bytes || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  const largest = [...files]
    .sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, TOP_N);

  return {
    totalBytes,
    fileCount: files.length,
    budgetBytes: CONTEXT_BUDGET_BYTES,
    budgetRatio,
    status,
    byCategory: categoryTotals,
    largest,
    suggestions: buildSuggestions(files, byCategory, totalBytes, status),
  };
}
