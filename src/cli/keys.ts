/**
 * Key handling for the Ink app as a pure reducer (DESIGN §8 interactions):
 * j/k or arrows select, enter opens the browser, `a` add folder, `s` scan
 * folder recursively, `q` quit. Prompts (path entry) and scan offers are
 * modes of the same reducer so every transition is unit-testable without
 * rendering anything.
 *
 * The reducer owns the MODE; list mutation and I/O are emitted as effects
 * for the component to apply (keeps this module free of fs/instances).
 */

export type UiMode =
  | { kind: 'list' }
  | { kind: 'prompt'; action: 'add' | 'scan'; value: string }
  /** Scan finished: hits are offered as instances to add (y/n). */
  | { kind: 'offer'; hits: readonly string[] };

/** Subset of Ink's useInput key event, decoupled so tests need no Ink. */
export interface KeyEvent {
  input: string;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export type KeyEffect =
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'open' }
  | { type: 'quit' }
  | { type: 'add'; path: string }
  | { type: 'scan'; path: string }
  | { type: 'acceptOffer'; hits: readonly string[] }
  | { type: 'declineOffer' };

export interface KeyResult {
  mode: UiMode;
  effects: readonly KeyEffect[];
}

const LIST: UiMode = { kind: 'list' };

function handleListKey(key: KeyEvent): KeyResult {
  if (key.downArrow || key.input === 'j')
    return { mode: LIST, effects: [{ type: 'move', delta: 1 }] };
  if (key.upArrow || key.input === 'k')
    return { mode: LIST, effects: [{ type: 'move', delta: -1 }] };
  if (key.return) return { mode: LIST, effects: [{ type: 'open' }] };
  if (key.input === 'q') return { mode: LIST, effects: [{ type: 'quit' }] };
  if (key.input === 'a') return { mode: { kind: 'prompt', action: 'add', value: '' }, effects: [] };
  if (key.input === 's')
    return { mode: { kind: 'prompt', action: 'scan', value: '' }, effects: [] };
  return { mode: LIST, effects: [] };
}

function handlePromptKey(mode: Extract<UiMode, { kind: 'prompt' }>, key: KeyEvent): KeyResult {
  if (key.escape) return { mode: LIST, effects: [] };
  if (key.return) {
    const path = mode.value.trim();
    if (path === '') return { mode: LIST, effects: [] }; // empty submit = cancel
    return { mode: LIST, effects: [{ type: mode.action, path }] };
  }
  if (key.backspace || key.delete) {
    return { mode: { ...mode, value: mode.value.slice(0, -1) }, effects: [] };
  }
  if (key.input !== '' && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
    return { mode: { ...mode, value: mode.value + key.input }, effects: [] };
  }
  return { mode, effects: [] };
}

function handleOfferKey(mode: Extract<UiMode, { kind: 'offer' }>, key: KeyEvent): KeyResult {
  if (key.return || key.input === 'y' || key.input === 'Y') {
    return { mode: LIST, effects: [{ type: 'acceptOffer', hits: mode.hits }] };
  }
  if (key.escape || key.input === 'n' || key.input === 'N' || key.input === 'q') {
    return { mode: LIST, effects: [{ type: 'declineOffer' }] };
  }
  return { mode, effects: [] };
}

export function handleKey(mode: UiMode, key: KeyEvent): KeyResult {
  switch (mode.kind) {
    case 'list':
      return handleListKey(key);
    case 'prompt':
      return handlePromptKey(mode, key);
    case 'offer':
      return handleOfferKey(mode, key);
  }
}
