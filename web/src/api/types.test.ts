import { describe, expect, it } from 'vitest';
import { isGlobalEntryError, type GlobalEntry, type GlobalEntryError } from './types.js';

const ENTRY: GlobalEntry = {
  root: '/home/u/.claude',
  dir: '.claude',
  agents: [],
  findings: [],
  stats: { fileCount: 0, totalBytes: 0 },
};

const ERROR_ENTRY: GlobalEntryError = {
  root: '/home/u/.cursor',
  dir: '.cursor',
  error: { name: 'Error', code: 'EACCES', message: 'permission denied' },
};

describe('isGlobalEntryError', () => {
  it('narrows the error variant', () => {
    expect(isGlobalEntryError(ERROR_ENTRY)).toBe(true);
  });

  it('rejects a successful entry', () => {
    expect(isGlobalEntryError(ENTRY)).toBe(false);
  });
});
