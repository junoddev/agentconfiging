import { describe, expect, it } from 'vitest';
import { sourceBadgeText } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { globalKeybindingsSource, globalKeybindingsWritable } from './Keybindings.js';
import type { ParsedKeybindings } from './keybindings/logic.js';

describe('globalKeybindingsSource (inherited ~/.claude, bead 71h.4)', () => {
  it('derives the absolute keybindings.json path from the .claude entry', () => {
    const entries = [
      { root: '/Users/x/.codex', dir: '.codex' },
      { root: '/Users/x/.claude', dir: '.claude' },
    ];
    expect(globalKeybindingsSource(entries)).toEqual({
      root: '/Users/x/.claude',
      path: '/Users/x/.claude/keybindings.json',
    });
  });

  it('is a no-op (undefined) when there is no .claude entry', () => {
    expect(globalKeybindingsSource([])).toBeUndefined();
    expect(globalKeybindingsSource([{ root: '/Users/x/.cursor', dir: '.cursor' }])).toBeUndefined();
  });

  it('never yields the project write target', () => {
    const src = globalKeybindingsSource([{ root: '/Users/x/.claude', dir: '.claude' }]);
    expect(src?.path.startsWith('/')).toBe(true);
    expect(src?.path).not.toBe('.claude/keybindings.json');
  });

  it('composes the GLOBAL badge text — READ-ONLY marker only when actually read-only (71h.10)', () => {
    const src = globalKeybindingsSource([{ root: '/Users/x/.claude', dir: '.claude' }]);
    expect(sourceBadgeText('global', homeRel(src!.root), true)).toBe(
      'GLOBAL · ~/.claude · READ-ONLY',
    );
    expect(sourceBadgeText('global', homeRel(src!.root), false)).toBe('GLOBAL · ~/.claude');
  });
});

describe('globalKeybindingsWritable (global unlock, bead 71h.10)', () => {
  const parsed = (parseError: boolean): ParsedKeybindings => ({
    bindings: [],
    doc: {},
    shape: 'object',
    parseError,
    hasBindings: true,
  });

  it('an unredacted, cleanly parsed global file is EDITABLE', () => {
    expect(
      globalKeybindingsWritable({ status: 'ready', redacted: false, parsed: parsed(false) }),
    ).toBe(true);
  });

  it('a redacted global file stays read-only (the save trap)', () => {
    expect(
      globalKeybindingsWritable({ status: 'ready', redacted: true, parsed: parsed(false) }),
    ).toBe(false);
  });

  it('parse failures and non-ready states are never write targets', () => {
    expect(
      globalKeybindingsWritable({ status: 'ready', redacted: false, parsed: parsed(true) }),
    ).toBe(false);
    expect(globalKeybindingsWritable({ status: 'loading' })).toBe(false);
    expect(globalKeybindingsWritable({ status: 'error' })).toBe(false);
    expect(globalKeybindingsWritable(undefined)).toBe(false);
  });
});
