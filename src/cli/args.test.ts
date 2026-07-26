import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('defaults to launch when no command is given', () => {
    expect(parseCliArgs([])).toEqual({ command: 'launch' });
  });

  it('recognizes launch and daemon', () => {
    expect(parseCliArgs(['launch'])).toEqual({ command: 'launch' });
    expect(parseCliArgs(['daemon'])).toEqual({ command: 'daemon' });
  });

  it('rejects unknown commands', () => {
    expect(() => parseCliArgs(['frobnicate'])).toThrow(/unknown command: frobnicate/);
  });

  describe('report', () => {
    it('parses bare report with flag defaults', () => {
      expect(parseCliArgs(['report'])).toEqual({
        command: 'report',
        pretty: false,
        global: false,
        help: false,
      });
    });

    it('parses path and flags in any order', () => {
      expect(parseCliArgs(['report', '--pretty', 'some/dir', '--global'])).toEqual({
        command: 'report',
        path: 'some/dir',
        pretty: true,
        global: true,
        help: false,
      });
    });

    it('parses -h and --help', () => {
      expect(parseCliArgs(['report', '-h'])).toMatchObject({ help: true });
      expect(parseCliArgs(['report', '--help'])).toMatchObject({ help: true });
    });

    it('rejects unknown flags and extra positionals', () => {
      expect(() => parseCliArgs(['report', '--nope'])).toThrow(/unknown flag for report: --nope/);
      expect(() => parseCliArgs(['report', 'a', 'b'])).toThrow(/unexpected extra argument: b/);
    });
  });
});
