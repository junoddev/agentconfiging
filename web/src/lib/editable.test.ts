import { describe, expect, it } from 'vitest';
import { fileReadOnly } from './editable.js';

describe('fileReadOnly (global editor unlock, bead 71h.10)', () => {
  it('a redacted file stays read-only — project or inherited global', () => {
    expect(fileReadOnly({ redacted: true, inherited: false })).toBe(true);
    expect(fileReadOnly({ redacted: true, inherited: true })).toBe(true);
  });

  it('an UNREDACTED inherited global file is EDITABLE (the 71h.10 unlock)', () => {
    expect(fileReadOnly({ redacted: false, inherited: true })).toBe(false);
  });

  it('an unredacted project file is editable, as before', () => {
    expect(fileReadOnly({ redacted: false, inherited: false })).toBe(false);
  });
});
