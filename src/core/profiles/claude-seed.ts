import type {
  HookEventDefinition,
  ModelDefinition,
  SettingDefinition,
  ToolDefinition,
} from './types.js';

/** Existing hand-verified Claude catalog snapshot; do not treat as a live upstream probe. */
export const CLAUDE_CATALOG_DATE = '2026-07-26';

export const CLAUDE_SETTINGS_SEED: readonly SettingDefinition[] = [
  { key: 'model', valueType: 'string' },
  { key: 'env', valueType: 'object' },
  { key: 'statusLine', valueType: 'object' },
  { key: 'permissions', valueType: 'object' },
  { key: 'hooks', valueType: 'object' },
  { key: 'enableAllProjectMcpServers', valueType: 'boolean' },
];

export const CLAUDE_TOOLS_SEED: readonly ToolDefinition[] = [
  'Agent',
  'Artifact',
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'KillBash',
  'KillShell',
  'ListMcpResources',
  'LS',
  'Monitor',
  'MultiEdit',
  'NotebookEdit',
  'NotebookRead',
  'PushNotification',
  'Read',
  'ReadMcpResource',
  'ScheduleWakeup',
  'SendMessage',
  'Skill',
  'SlashCommand',
  'Task',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoRead',
  'TodoWrite',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
].map((name) => ({ name }));

export const CLAUDE_CURRENT_MODELS_SEED: readonly ModelDefinition[] = [
  'default',
  'opus',
  'opusplan',
  'sonnet',
  'haiku',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-0',
].map((id) => ({ id, purpose: 'runtime-capability' }));

export const CLAUDE_STALE_MODELS_SEED: readonly ModelDefinition[] = Object.entries({
  'claude-3-opus-20240229': 'claude-opus-4-5',
  'claude-3-sonnet-20240229': 'claude-sonnet-4-5',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-5',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-5',
  'claude-2.1': 'claude-opus-4-5',
  'claude-2.0': 'claude-opus-4-5',
  'claude-instant-1.2': 'claude-haiku-4-5',
  'gpt-4': 'gpt-4o',
  'gpt-4-32k': 'gpt-4o',
  'gpt-3.5-turbo': 'gpt-4o-mini',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-1.0-pro': 'gemini-2.5-pro',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-flash': 'gemini-2.5-flash',
}).map(([id, replacement]) => ({
  id,
  replacement,
  purpose: 'cross-provider-reference-compatibility',
}));

export const CLAUDE_HOOK_EVENTS_SEED: readonly HookEventDefinition[] = [
  { name: 'SessionStart', description: 'a session begins or resumes', matcherApplies: false },
  {
    name: 'UserPromptSubmit',
    description: 'the user submits a prompt, before the model sees it',
    matcherApplies: false,
  },
  {
    name: 'PreToolUse',
    description: 'before a tool runs — can block or gate the call',
    matcherApplies: true,
  },
  { name: 'PostToolUse', description: 'after a tool returns a result', matcherApplies: true },
  {
    name: 'Notification',
    description: 'the agent emits a notification (e.g. awaiting input)',
    matcherApplies: false,
  },
  {
    name: 'PreCompact',
    description: 'before the context window is compacted',
    matcherApplies: false,
  },
  { name: 'Stop', description: 'the main agent finishes responding', matcherApplies: false },
  {
    name: 'SubagentStop',
    description: 'a spawned subagent finishes responding',
    matcherApplies: false,
  },
  { name: 'SessionEnd', description: 'a session ends', matcherApplies: false },
];
