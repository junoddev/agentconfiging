import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('defaults to launch when no command is given', () => {
    expect(parseCliArgs([])).toEqual({ command: 'launch' });
  });

  it('recognizes report and daemon', () => {
    expect(parseCliArgs(['report'])).toEqual({ command: 'report' });
    expect(parseCliArgs(['daemon'])).toEqual({ command: 'daemon' });
  });

  it('rejects unknown commands', () => {
    expect(() => parseCliArgs(['frobnicate'])).toThrow(/unknown command: frobnicate/);
  });
});
