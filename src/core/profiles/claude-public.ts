import {
  CLAUDE_CATALOG_DATE,
  CLAUDE_CURRENT_MODELS_SEED,
  CLAUDE_HOOK_EVENTS_SEED,
  CLAUDE_SETTINGS_SEED,
  CLAUDE_STALE_MODELS_SEED,
  CLAUDE_TOOLS_SEED,
} from './claude-seed.js';
import type { ClaudeCatalogProjection } from './claude.js';

/**
 * Browser-safe generated view of the Claude seed data. This module deliberately
 * cannot reach profiles/data.ts, so evidence and promotion metadata cannot be
 * pulled into a client bundle.
 */
export const CLAUDE_PUBLIC_CATALOG: ClaudeCatalogProjection = {
  checkedAt: CLAUDE_CATALOG_DATE,
  settings: CLAUDE_SETTINGS_SEED,
  tools: CLAUDE_TOOLS_SEED.map((tool) => tool.name),
  currentModels: CLAUDE_CURRENT_MODELS_SEED.map((model) => model.id),
  staleModelReplacements: Object.fromEntries(
    CLAUDE_STALE_MODELS_SEED.map((model) => [model.id, model.replacement!]),
  ),
  hookEvents: CLAUDE_HOOK_EVENTS_SEED,
};
