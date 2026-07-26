import { describe, expect, it } from 'vitest';
import { handleKey, type KeyEvent, type UiMode } from './keys.js';

const LIST: UiMode = { kind: 'list' };

function key(partial: Partial<KeyEvent>): KeyEvent {
  return { input: '', ...partial };
}

describe('list mode', () => {
  it('j / down arrow move down, k / up arrow move up', () => {
    expect(handleKey(LIST, key({ input: 'j' })).effects).toEqual([{ type: 'move', delta: 1 }]);
    expect(handleKey(LIST, key({ downArrow: true })).effects).toEqual([{ type: 'move', delta: 1 }]);
    expect(handleKey(LIST, key({ input: 'k' })).effects).toEqual([{ type: 'move', delta: -1 }]);
    expect(handleKey(LIST, key({ upArrow: true })).effects).toEqual([{ type: 'move', delta: -1 }]);
  });

  it('enter opens the selected instance in the browser', () => {
    expect(handleKey(LIST, key({ return: true })).effects).toEqual([{ type: 'open' }]);
  });

  it('q quits', () => {
    expect(handleKey(LIST, key({ input: 'q' })).effects).toEqual([{ type: 'quit' }]);
  });

  it('a and s open the respective prompts without effects', () => {
    expect(handleKey(LIST, key({ input: 'a' }))).toEqual({
      mode: { kind: 'prompt', action: 'add', value: '' },
      effects: [],
    });
    expect(handleKey(LIST, key({ input: 's' }))).toEqual({
      mode: { kind: 'prompt', action: 'scan', value: '' },
      effects: [],
    });
  });

  it('other keys are inert', () => {
    expect(handleKey(LIST, key({ input: 'x' }))).toEqual({ mode: LIST, effects: [] });
  });
});

describe('prompt mode', () => {
  const prompt = (value: string): UiMode => ({ kind: 'prompt', action: 'add', value });

  it('printable input appends; q types a q instead of quitting', () => {
    let result = handleKey(prompt(''), key({ input: '/t' }));
    result = handleKey(result.mode, key({ input: 'q' }));
    expect(result).toEqual({ mode: prompt('/tq'), effects: [] });
  });

  it('backspace and delete remove the last character', () => {
    expect(handleKey(prompt('ab'), key({ backspace: true })).mode).toEqual(prompt('a'));
    expect(handleKey(prompt('ab'), key({ delete: true })).mode).toEqual(prompt('a'));
  });

  it('ctrl/meta chords are ignored', () => {
    expect(handleKey(prompt('a'), key({ input: 'c', ctrl: true })).mode).toEqual(prompt('a'));
    expect(handleKey(prompt('a'), key({ input: 'v', meta: true })).mode).toEqual(prompt('a'));
  });

  it('escape cancels back to list', () => {
    expect(handleKey(prompt('/x'), key({ escape: true }))).toEqual({ mode: LIST, effects: [] });
  });

  it('enter submits a trimmed path as the add effect', () => {
    expect(handleKey(prompt('  /projects/x '), key({ return: true }))).toEqual({
      mode: LIST,
      effects: [{ type: 'add', path: '/projects/x' }],
    });
  });

  it('enter on the scan prompt emits scan', () => {
    const mode: UiMode = { kind: 'prompt', action: 'scan', value: '/repos' };
    expect(handleKey(mode, key({ return: true })).effects).toEqual([
      { type: 'scan', path: '/repos' },
    ]);
  });

  it('empty submit cancels without effects', () => {
    expect(handleKey(prompt('   '), key({ return: true }))).toEqual({ mode: LIST, effects: [] });
  });
});

describe('offer mode (scan hits offered as instances to add)', () => {
  const hits = ['/a', '/b'];
  const offer: UiMode = { kind: 'offer', hits };

  it('y or enter accepts all hits', () => {
    expect(handleKey(offer, key({ input: 'y' }))).toEqual({
      mode: LIST,
      effects: [{ type: 'acceptOffer', hits }],
    });
    expect(handleKey(offer, key({ return: true })).effects).toEqual([
      { type: 'acceptOffer', hits },
    ]);
  });

  it('n, escape, or q declines', () => {
    for (const k of [key({ input: 'n' }), key({ escape: true }), key({ input: 'q' })]) {
      expect(handleKey(offer, k)).toEqual({ mode: LIST, effects: [{ type: 'declineOffer' }] });
    }
  });

  it('other keys keep the offer open', () => {
    expect(handleKey(offer, key({ input: 'x' }))).toEqual({ mode: offer, effects: [] });
  });
});
