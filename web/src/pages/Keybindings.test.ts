import { describe, expect, it } from 'vitest';
import { sourceBadgeText } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { globalKeybindingsSource } from './Keybindings.js';

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

  it('composes the expected GLOBAL badge text for the section head', () => {
    const src = globalKeybindingsSource([{ root: '/Users/x/.claude', dir: '.claude' }]);
    expect(sourceBadgeText('global', homeRel(src!.root), true)).toBe(
      'GLOBAL · ~/.claude · READ-ONLY',
    );
  });
});
