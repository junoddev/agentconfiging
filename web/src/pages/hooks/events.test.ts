import { describe, expect, it } from 'vitest';
import { findHookEvent, HOOK_EVENTS, isKnownHookEvent } from './events.js';

describe('HOOK_EVENTS data file', () => {
  it('lists the core Claude Code hook events we track upstream', () => {
    const names = HOOK_EVENTS.map((e) => e.name);
    for (const core of [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'Notification',
      'Stop',
      'SubagentStop',
      'PreCompact',
      'SessionStart',
      'SessionEnd',
    ]) {
      expect(names).toContain(core);
    }
  });

  it('has unique names and a non-empty description for every event', () => {
    const names = HOOK_EVENTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of HOOK_EVENTS) {
      expect(e.name.trim()).not.toBe('');
      expect(e.description.trim()).not.toBe('');
    }
  });

  it('marks only the tool-scoped events as matcher-applicable', () => {
    expect(findHookEvent('PreToolUse')?.matcherApplies).toBe(true);
    expect(findHookEvent('PostToolUse')?.matcherApplies).toBe(true);
    expect(findHookEvent('Stop')?.matcherApplies).toBe(false);
    expect(findHookEvent('SessionStart')?.matcherApplies).toBe(false);
  });

  it('resolves membership and lookup', () => {
    expect(isKnownHookEvent('PreToolUse')).toBe(true);
    expect(isKnownHookEvent('NotAnEvent')).toBe(false);
    expect(findHookEvent('NotAnEvent')).toBeUndefined();
  });
});
