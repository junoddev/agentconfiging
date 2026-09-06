/**
 * Analyzer barrel — auto-discovery wiring (SPEC §4.1), mirroring
 * src/core/detectors/index.ts.
 *
 * Each analyzer module self-registers on import (see registry.ts). The
 * side-effect imports below are the ONLY wiring an analyzer needs beyond
 * its own file. `registry.test.ts` fs-reads this directory and fails if
 * any analyzer module file is missing from the registry.
 *
 * Analyzer provenance (vs ../markdowning's 9 Elixir analyzers):
 *   PORTED   missing-project-guide, no-agents-no-skills,
 *            settings-local-committed
 *   UPGRADED conflicting-instructions (word-count ratio → directive
 *            token-similarity), rules-drift (raw-word Jaccard → directive
 *            token-similarity; was cursor_and_claude_rules_drift),
 *            permissive-permissions (ad-hoc JSON → parsed settings model),
 *            stale-model-ref (raw grep → parsed model fields + data file),
 *            tiny-project-guide (added a detected-runtime gate the Elixir
 *            original lacked)
 *   NEW      broken-import, duplicate-rules, hook-script-missing,
 *            mcp-command-not-on-path, subagent-references-missing-tool
 *   DROPPED  no_agent_detected — "nothing detected" is the UI's empty
 *            state, not a finding (and a clean non-agent repo must
 *            produce zero findings).
 */

import './broken-import.js';
import './conflicting-instructions.js';
import './duplicate-rules.js';
import './hook-script-missing.js';
import './mcp-command-not-on-path.js';
import './missing-project-guide.js';
import './no-agents-no-skills.js';
import './permissive-permissions.js';
import './quality-bloat.js';
import './rules-drift.js';
import './settings-local-committed.js';
import './stale-model-ref.js';
import './subagent-references-missing-tool.js';
import './tiny-project-guide.js';

export { allAnalyzers, registerAnalyzer } from './registry.js';
export type { Analyzer } from './types.js';
export { KNOWN_CLAUDE_TOOLS, KNOWN_TOOLS_DATE } from './known-tools.js';
export { KNOWN_CURRENT_MODELS, MODEL_DATA_DATE, STALE_MODEL_REPLACEMENTS } from './stale-models.js';
