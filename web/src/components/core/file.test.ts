import { describe, expect, it } from 'vitest';
import { fileChipTitle, formatBytes } from './file.js';

describe('formatBytes', () => {
  it('shows bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows one-decimal KB below 1 MiB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(3120)).toBe('3.0 KB');
  });

  it('shows one-decimal MB below 1 GiB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB');
  });

  it('shows one-decimal GB from 1 GiB up', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('fileChipTitle', () => {
  it('joins size and sha with the interpunct', () => {
    expect(fileChipTitle(3120, 'a1b2c3d4')).toBe('3.0 KB · a1b2c3d4');
  });

  it('shows whichever part is present', () => {
    expect(fileChipTitle(512)).toBe('512 B');
    expect(fileChipTitle(undefined, 'a1b2c3d4')).toBe('a1b2c3d4');
  });

  it('returns undefined when there is nothing to show', () => {
    expect(fileChipTitle()).toBeUndefined();
    expect(fileChipTitle(undefined, '')).toBeUndefined();
  });
});
