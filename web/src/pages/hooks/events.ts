/**
 * DATA FILE — Claude Code hook events (bead agentconfig-wmc.5).
 *
 * PROVENANCE: hand-curated from the Claude Code hooks documentation, snapshot
 * 2026-07-26. Like the analyzers' catalogue data files, this list TRACKS
 * UPSTREAM: Anthropic adds/renames hook events over time, so this is the single
 * place to update when the docs change — no other file hardcodes event names.
 *
 * COMPLETENESS NOTE: this file lists the events we can currently source with
 * confidence from the public docs. SPEC §5 anticipates the full upstream set
 * (~22 including internal/experimental events); when the remaining events are
 * confirmed upstream, append them here (keep alphabetical-by-lifecycle order and
 * fill `matcherApplies`). The sidebar renders whatever this list contains.
 */

/** One Claude Code hook event the manager can attach hooks to. */
export interface HookEvent {
  /** Exact event name as it appears as a key under settings.json `hooks`. */
  readonly name: string;
  /** One-line description of when the event fires (§7 voice, lower-case). */
  readonly description: string;
  /**
   * Whether a `matcher` (e.g. a tool name / pattern) is meaningful for this
   * event. Tool-scoped events use matchers; lifecycle events run unconditionally
   * and the form hides the matcher field for them.
   */
  readonly matcherApplies: boolean;
}

/**
 * The tracked event catalogue. Ordered roughly by session lifecycle:
 * start → prompt → tool → compact → stop → end.
 */
export const HOOK_EVENTS: readonly HookEvent[] = [
  {
    name: 'SessionStart',
    description: 'a session begins or resumes',
    matcherApplies: false,
  },
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
  {
    name: 'PostToolUse',
    description: 'after a tool returns a result',
    matcherApplies: true,
  },
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
  {
    name: 'Stop',
    description: 'the main agent finishes responding',
    matcherApplies: false,
  },
  {
    name: 'SubagentStop',
    description: 'a spawned subagent finishes responding',
    matcherApplies: false,
  },
  {
    name: 'SessionEnd',
    description: 'a session ends',
    matcherApplies: false,
  },
];

/** Fast membership + lookup for parse-time classification and the form. */
const EVENTS_BY_NAME = new Map<string, HookEvent>(HOOK_EVENTS.map((e) => [e.name, e]));

/** The catalogue event for `name`, or undefined if it is not (yet) tracked. */
export function findHookEvent(name: string): HookEvent | undefined {
  return EVENTS_BY_NAME.get(name);
}

/** Whether `name` is one of the tracked hook events. */
export function isKnownHookEvent(name: string): boolean {
  return EVENTS_BY_NAME.has(name);
}
