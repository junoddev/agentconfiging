/** Legacy analyzer API, projected from the canonical Claude Code profile. */
import { CLAUDE_CATALOG } from '../profiles/claude.js';

export const MODEL_DATA_DATE = CLAUDE_CATALOG.checkedAt;
export const KNOWN_CURRENT_MODELS: readonly string[] = CLAUDE_CATALOG.currentModels;
export const STALE_MODEL_REPLACEMENTS: Readonly<Record<string, string>> =
  CLAUDE_CATALOG.staleModelReplacements;
