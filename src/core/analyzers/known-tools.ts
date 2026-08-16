/** Legacy analyzer API, projected from the canonical Claude Code profile. */
import { CLAUDE_CATALOG } from '../profiles/claude.js';

export const KNOWN_TOOLS_DATE = CLAUDE_CATALOG.checkedAt;
export const KNOWN_CLAUDE_TOOLS: readonly string[] = CLAUDE_CATALOG.tools;
