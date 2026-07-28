import { describe, expect, it } from 'vitest';
import {
  addHookToSettings,
  contentHasRedactionMarks,
  draftFromTemplate,
  emptyDraft,
  globalHookCards,
  globalHookSource,
  groupByEvent,
  HOOK_TEMPLATES,
  isDraftValid,
  isRedacted,
  parseHooksBlock,
  removeHookFromSettings,
  type HookDraft,
} from './logic.js';

/** The real shape, mirroring fixtures/trees/claude-rich/.claude/settings.json. */
const RICH = JSON.stringify({
  model: 'claude-opus-4-5',
  env: { NODE_OPTIONS: '--max-old-space-size=4096' },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/check.sh' }] }],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: 'npx prettier --write "$CLAUDE_FILE_PATHS"' }],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: '.claude/notify.sh', timeout: 30 }] }],
  },
});

describe('parseHooksBlock', () => {
  it('flattens the hooks block into per-command cards with context', () => {
    const res = parseHooksBlock(RICH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entries).toHaveLength(3);

    expect(res.entries[0]).toEqual({
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: '.claude/check.sh',
      groupIndex: 0,
      hookIndex: 0,
    });
    // Stop has no matcher and carries a timeout.
    expect(res.entries[2]).toMatchObject({
      event: 'Stop',
      type: 'command',
      command: '.claude/notify.sh',
      timeout: 30,
    });
    expect(res.entries[2]).not.toHaveProperty('matcher');
  });

  it('treats an absent hooks block as a valid, empty result', () => {
    const res = parseHooksBlock(JSON.stringify({ model: 'x' }));
    expect(res).toEqual({ ok: true, entries: [] });
  });

  it('reports malformed JSON', () => {
    expect(parseHooksBlock('{ not json')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('reports a non-object top level', () => {
    expect(parseHooksBlock('[1,2,3]')).toEqual({ ok: false, reason: 'not-object' });
  });

  it('reports a hooks value that is not an object', () => {
    expect(parseHooksBlock(JSON.stringify({ hooks: 'nope' }))).toEqual({
      ok: false,
      reason: 'hooks-not-object',
    });
  });

  it('skips malformed group/hook entries without throwing', () => {
    const content = JSON.stringify({
      hooks: {
        PreToolUse: [
          'not-an-object',
          { hooks: 'not-an-array' },
          { hooks: [42, { command: 'ok' }] },
        ],
        BadEvent: 'not-an-array',
      },
    });
    const res = parseHooksBlock(content);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only the single well-formed command survives.
    expect(res.entries).toEqual([
      { event: 'PreToolUse', type: undefined, groupIndex: 2, hookIndex: 1, command: 'ok' },
    ]);
  });

  it('renders adversarial command/matcher text verbatim (no execution, no escaping)', () => {
    const nasty = '<script>$(rm -rf /)</script>; `id`';
    const res = parseHooksBlock(
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: nasty }] }] } }),
    );
    expect(res.ok && res.entries[0]?.command).toBe(nasty);
  });
});

describe('globalHookSource (inherited ~/.claude, bead 71h.4)', () => {
  const claudeEntry = {
    root: '/Users/x/.claude',
    dir: '.claude',
    agents: [
      { kind: 'claude-code', confidence: 'high' as const, files: ['settings.json'], extras: {} },
    ],
  };
  const codexEntry = {
    root: '/Users/x/.codex',
    dir: '.codex',
    agents: [{ kind: 'codex', confidence: 'low' as const, files: ['settings.json'], extras: {} }],
  };

  it('derives the absolute settings.json path from the .claude entry', () => {
    expect(globalHookSource([codexEntry, claudeEntry])).toEqual({
      root: '/Users/x/.claude',
      path: '/Users/x/.claude/settings.json',
    });
  });

  it('is a no-op (undefined) when there is no .claude entry', () => {
    expect(globalHookSource([])).toBeUndefined();
    expect(globalHookSource([codexEntry])).toBeUndefined();
  });

  it('is a no-op when the .claude entry carries no settings.json', () => {
    const noSettings = {
      ...claudeEntry,
      agents: [
        { kind: 'claude-code', confidence: 'low' as const, files: ['CLAUDE.md'], extras: {} },
      ],
    };
    expect(globalHookSource([noSettings])).toBeUndefined();
  });

  it('never yields a project-relative write-target path', () => {
    const src = globalHookSource([claudeEntry]);
    // Absolute (starts at /) — structurally distinct from the page's writable
    // '.claude/settings.json' / '.claude/settings.local.json' targets.
    expect(src?.path.startsWith('/')).toBe(true);
    expect(['.claude/settings.json', '.claude/settings.local.json']).not.toContain(src?.path);
  });
});

describe('globalHookCards', () => {
  it('marks every card readOnly with the given source label', () => {
    const parse = parseHooksBlock(RICH);
    const cards = globalHookCards(parse, '~/.claude/settings.json');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.readOnly).toBe(true);
      expect(card.source).toBe('~/.claude/settings.json');
    }
  });

  it('yields no cards for an absent or failed parse', () => {
    expect(globalHookCards(undefined, 'x')).toEqual([]);
    expect(globalHookCards(parseHooksBlock('{ not json'), 'x')).toEqual([]);
  });
});

describe('groupByEvent', () => {
  it('buckets entries by event, preserving first-seen order', () => {
    const res = parseHooksBlock(RICH);
    if (!res.ok) throw new Error('parse failed');
    const grouped = groupByEvent(res.entries);
    expect([...grouped.keys()]).toEqual(['PreToolUse', 'PostToolUse', 'Stop']);
    expect(grouped.get('PreToolUse')).toHaveLength(1);
  });
});

describe('redaction detection (save trap)', () => {
  it('flags spans present', () => {
    expect(isRedacted([{ start: 1, end: 2, id: 'openai' }])).toBe(true);
    expect(isRedacted([])).toBe(false);
  });

  it('scans raw content for a redaction mark', () => {
    expect(contentHasRedactionMarks('"key": "[REDACTED:github]"')).toBe(true);
    expect(contentHasRedactionMarks('"key": "value"')).toBe(false);
  });
});

describe('templates & drafts', () => {
  it('ships the four named quick-add templates', () => {
    expect(HOOK_TEMPLATES.map((t) => t.id)).toEqual(['shell', 'webhook', 'guard', 'log']);
    for (const t of HOOK_TEMPLATES) {
      expect(t.command.trim()).not.toBe('');
      expect(isDraftValid(draftFromTemplate(t))).toBe(true);
    }
  });

  it('an empty draft is invalid until it has a command', () => {
    const d = emptyDraft('Stop');
    expect(isDraftValid(d)).toBe(false);
    expect(isDraftValid({ ...d, command: '.claude/x.sh' })).toBe(true);
  });
});

describe('addHookToSettings', () => {
  const draft: HookDraft = {
    event: 'Stop',
    matcher: '',
    type: 'command',
    command: '.claude/new.sh',
  };

  it('appends a new matcher-group and round-trips through the parser', () => {
    const next = addHookToSettings(RICH, draft);
    const res = parseHooksBlock(next);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stop = res.entries.filter((e) => e.event === 'Stop');
    expect(stop).toHaveLength(2);
    expect(stop[1]?.command).toBe('.claude/new.sh');
  });

  it('creates the hooks block for a file that had none, preserving other keys', () => {
    const next = addHookToSettings(JSON.stringify({ model: 'claude-x' }), draft);
    const obj = JSON.parse(next) as Record<string, unknown>;
    expect(obj['model']).toBe('claude-x');
    expect(obj['hooks']).toBeDefined();
    const res = parseHooksBlock(next);
    expect(res.ok && res.entries[0]?.command).toBe('.claude/new.sh');
  });

  it('omits an empty matcher but writes a provided one', () => {
    const noMatcher = JSON.parse(addHookToSettings('{}', draft)) as {
      hooks: { Stop: Record<string, unknown>[] };
    };
    expect(noMatcher.hooks.Stop[0]).not.toHaveProperty('matcher');

    const withMatcher = JSON.parse(
      addHookToSettings('{}', { ...draft, event: 'PreToolUse', matcher: 'Bash' }),
    ) as { hooks: { PreToolUse: Record<string, unknown>[] } };
    expect(withMatcher.hooks.PreToolUse[0]?.['matcher']).toBe('Bash');
  });

  it('serializes with two-space indent and a trailing newline', () => {
    const next = addHookToSettings('{}', draft);
    expect(next.endsWith('\n')).toBe(true);
    expect(next).toContain('\n  "hooks"');
  });

  it('refuses to write when the content carries redaction marks', () => {
    const redacted = '{ "env": { "KEY": "[REDACTED:openai]" } }';
    expect(() => addHookToSettings(redacted, draft)).toThrow(/redacted/);
  });

  it('refuses invalid JSON', () => {
    expect(() => addHookToSettings('{ bad', draft)).toThrow(/valid JSON/);
  });
});

describe('removeHookFromSettings', () => {
  it('removes one command and prunes the emptied group + event', () => {
    const next = removeHookFromSettings(RICH, 'Stop', 0, 0);
    const res = parseHooksBlock(next);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entries.some((e) => e.event === 'Stop')).toBe(false);
    // Other events untouched.
    expect(res.entries.map((e) => e.event)).toEqual(['PreToolUse', 'PostToolUse']);
  });

  it('keeps sibling commands when a group has more than one', () => {
    const multi = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: 'a' }, { command: 'b' }] }] },
    });
    const next = removeHookFromSettings(multi, 'Stop', 0, 0);
    const res = parseHooksBlock(next);
    expect(res.ok && res.entries.map((e) => e.command)).toEqual(['b']);
  });

  it('drops the whole hooks block when the last hook is removed', () => {
    const only = JSON.stringify({ model: 'm', hooks: { Stop: [{ hooks: [{ command: 'a' }] }] } });
    const obj = JSON.parse(removeHookFromSettings(only, 'Stop', 0, 0)) as Record<string, unknown>;
    expect(obj).not.toHaveProperty('hooks');
    expect(obj['model']).toBe('m');
  });

  it('is a safe round-trip on out-of-range coordinates', () => {
    const next = removeHookFromSettings(RICH, 'Stop', 9, 9);
    const res = parseHooksBlock(next);
    expect(res.ok && res.entries).toHaveLength(3);
  });

  it('refuses redacted content', () => {
    expect(() => removeHookFromSettings('{ "x": "[REDACTED:x]" }', 'Stop', 0, 0)).toThrow(
      /redacted/,
    );
  });
});
