/** Safe UI projection of canonical Claude Code profile data. */
import { CLAUDE_PUBLIC_CATALOG } from '../../../../src/core/profiles/claude-public.js';
import type { HookEventDefinition } from '../../../../src/core/profiles/types.js';

export type HookEvent = HookEventDefinition;
export const HOOK_EVENTS: readonly HookEvent[] = CLAUDE_PUBLIC_CATALOG.hookEvents;

const EVENTS_BY_NAME = new Map<string, HookEvent>(HOOK_EVENTS.map((event) => [event.name, event]));

export function findHookEvent(name: string): HookEvent | undefined {
  return EVENTS_BY_NAME.get(name);
}

export function isKnownHookEvent(name: string): boolean {
  return EVENTS_BY_NAME.has(name);
}
