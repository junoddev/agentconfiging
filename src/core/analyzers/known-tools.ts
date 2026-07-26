/**
 * Known Claude Code built-in tool names — DATA for the
 * `subagent-references-missing-tool` analyzer.
 *
 * Deliberately conservative (broad): the analyzer only flags a tool name
 * that is in NO recognized category, so a missing entry here produces a
 * false positive. When in doubt, add the name. Matching is
 * case-insensitive; `mcp__*` names and permission-style patterns
 * (containing '(') are never checked against this list.
 */

/** Date the list below was last verified. */
export const KNOWN_TOOLS_DATE = '2026-07-26';

export const KNOWN_CLAUDE_TOOLS: readonly string[] = [
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
];
