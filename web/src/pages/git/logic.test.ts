import { describe, expect, it } from 'vitest';
import { buildCommitMessage, hasChanges, statusLabel, statusTone, syncSummary } from './logic.js';

describe('buildCommitMessage', () => {
  it('builds type: subject', () => {
    expect(
      buildCommitMessage({
        type: 'feat',
        scope: '',
        subject: 'add panel',
        body: '',
        breaking: false,
      }),
    ).toBe('feat: add panel');
  });
  it('includes a scope and a body', () => {
    expect(
      buildCommitMessage({
        type: 'fix',
        scope: 'git',
        subject: 'stage',
        body: 'details',
        breaking: false,
      }),
    ).toBe('fix(git): stage\n\ndetails');
  });
  it('marks a breaking change and appends the footer', () => {
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'api',
      subject: 'drop v1',
      body: '',
      breaking: true,
    });
    expect(msg).toContain('feat(api)!: drop v1');
    expect(msg).toContain('BREAKING CHANGE: drop v1');
  });
  it('returns empty for a blank subject (commit stays disabled)', () => {
    expect(
      buildCommitMessage({ type: 'feat', scope: '', subject: '  ', body: '', breaking: false }),
    ).toBe('');
  });
  it('keeps a subject with shell-ish text literal (it is inert data)', () => {
    expect(
      buildCommitMessage({
        type: 'chore',
        scope: '',
        subject: 'x; $(id)',
        body: '',
        breaking: false,
      }),
    ).toBe('chore: x; $(id)');
  });
});

describe('statusLabel / statusTone', () => {
  it('maps porcelain letters to labels', () => {
    expect(statusLabel('M')).toBe('modified');
    expect(statusLabel('A')).toBe('added');
    expect(statusLabel('D')).toBe('deleted');
    expect(statusLabel('R')).toBe('renamed');
    expect(statusLabel('U')).toBe('conflict');
    expect(statusLabel('?')).toBe('changed');
  });
  it('maps letters to tones', () => {
    expect(statusTone('A')).toBe('add');
    expect(statusTone('D')).toBe('del');
    expect(statusTone('M')).toBe('mod');
  });
});

describe('hasChanges & syncSummary', () => {
  it('detects any change', () => {
    expect(hasChanges([], [], [])).toBe(false);
    expect(hasChanges([{ path: 'a', status: 'M' }], [], [])).toBe(true);
    expect(hasChanges([], [], ['x'])).toBe(true);
  });
  it('summarizes ahead/behind', () => {
    expect(syncSummary(0, 0)).toBe('');
    expect(syncSummary(2, 0)).toBe('↑2');
    expect(syncSummary(0, 3)).toBe('↓3');
    expect(syncSummary(2, 3)).toBe('↑2 ↓3');
  });
});
