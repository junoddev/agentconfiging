/**
 * Structural parsers (SPEC §4.1). Pure functions over file content strings —
 * zero I/O, never throw on malformed input, adversarial-data safe.
 */

export {
  parsed,
  failed,
  problem,
  problemFromError,
  scrubMessage,
  capProblems,
  MAX_PROBLEMS,
} from './result.js';
export type { ParseProblem, ParseResult } from './result.js';

export {
  MAX_DEPTH,
  MAX_NODES,
  MAX_INPUT_LENGTH,
  MAX_FLOW_DEPTH,
  sanitize,
  inputSizeProblem,
  flowNestingTooDeep,
  isRecord,
  ownEntries,
  asString,
  asBoolean,
  optionalString,
  optionalBoolean,
  optionalNumber,
  splitCommaList,
  toStringList,
  toEnvEntries,
  collectVarRefs,
  createFenceFilter,
} from './values.js';
export type { SafeRecord, EnvEntry } from './values.js';

export { parseJson, parseJsonRecord } from './json.js';
export { parseYaml } from './yaml.js';
export { parseToml } from './toml.js';
export { parseFrontmatter } from './frontmatter.js';
export type { Frontmatter } from './frontmatter.js';

export {
  parseClaudeSubagent,
  parseClaudeSkill,
  parseClaudeCommand,
  parseClaudeRule,
  parseClaudeMemory,
  parseClaudeSettings,
  parseKeybindings,
  parseClaudeMd,
} from './claude.js';
export type {
  ClaudeSubagent,
  ClaudeSkill,
  ClaudeCommand,
  ClaudeRule,
  ClaudeMemory,
  ClaudeSettings,
  StatusLineConfig,
  PermissionsConfig,
  HookCommand,
  HookGroup,
  Keybindings,
  ClaudeMd,
  ClaudeMdImport,
} from './claude.js';

export { parseMcpJson, mcpServersFromValue } from './mcp.js';
export type { McpConfig, McpServer } from './mcp.js';

export { parseCursorRule } from './cursor.js';
export type { CursorRule } from './cursor.js';

export { parseCopilotInstructions } from './copilot.js';
export type { CopilotInstructions } from './copilot.js';

export { parseGuide, firstHeadingOf } from './guides.js';
export type { Guide, GuideHeading } from './guides.js';
