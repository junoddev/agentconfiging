import { describe, expect, it } from 'vitest';
import type { ReportFinding } from '../../api/types.js';
import {
  countBySeverity,
  filterFindings,
  hasApplicableFix,
  rowSeverity,
  severityCountLabel,
} from './logic.js';

/** Sample set: 2 errors, 1 warning, 1 info; two carry a machine fix. Server
 *  delivers findings already severity-sorted, so the order below mirrors that. */
const SAMPLE: ReportFinding[] = [
  {
    id: 'e1',
    severity: 'error',
    agent: 'claude-code',
    title: '.claude/settings.local.json is committed',
    detail: 'a local settings file is tracked in git',
    suggestion: 'add .claude/settings.local.json to .gitignore',
    hasFix: true,
    fixKind: 'replace-file',
  },
  {
    id: 'e2',
    severity: 'error',
    agent: 'codex',
    title: 'AGENTS.md references a missing command',
    detail: 'the documented build command does not exist',
  },
  {
    id: 'w1',
    severity: 'warning',
    agent: 'claude-code',
    title: 'CLAUDE.md build commands section is empty',
    detail: 'no build or test commands are documented',
    suggestion: 'add build & test commands',
    hasFix: true,
    fixKind: 'create-file',
  },
  {
    id: 'i1',
    severity: 'info',
    agent: 'codex',
    title: 'config is minimal',
    detail: 'only one manifest file was found',
  },
];

describe('rowSeverity', () => {
  it('maps wire severity onto the FindingRow row-severity token', () => {
    expect(rowSeverity('error')).toBe('error');
    expect(rowSeverity('warning')).toBe('warn');
    expect(rowSeverity('info')).toBe('ok');
  });
});

describe('hasApplicableFix', () => {
  it('is true only when the server flagged a machine fix', () => {
    expect(hasApplicableFix(SAMPLE[0]!)).toBe(true);
    expect(hasApplicableFix(SAMPLE[1]!)).toBe(false);
    expect(hasApplicableFix({})).toBe(false);
  });
});

describe('countBySeverity', () => {
  it('tallies each severity band', () => {
    expect(countBySeverity(SAMPLE)).toEqual({ error: 2, warning: 1, info: 1 });
  });

  it('returns zeroed counts for an empty set', () => {
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('filterFindings', () => {
  it('keeps only findings whose severity is active, preserving order', () => {
    const visible = filterFindings(SAMPLE, new Set(['error', 'info']));
    expect(visible.map((f) => f.id)).toEqual(['e1', 'e2', 'i1']);
  });

  it('returns the full set (in order) when every band is active', () => {
    const visible = filterFindings(SAMPLE, new Set(['error', 'warning', 'info']));
    expect(visible.map((f) => f.id)).toEqual(['e1', 'e2', 'w1', 'i1']);
  });

  it('returns nothing when no band is active', () => {
    expect(filterFindings(SAMPLE, new Set())).toEqual([]);
  });
});

describe('severityCountLabel', () => {
  it('pluralizes error/warning and leaves info unchanged, §7 voice', () => {
    expect(severityCountLabel('error', 3)).toBe('3 ERRORS');
    expect(severityCountLabel('error', 1)).toBe('1 ERROR');
    expect(severityCountLabel('warning', 1)).toBe('1 WARNING');
    expect(severityCountLabel('warning', 5)).toBe('5 WARNINGS');
    expect(severityCountLabel('info', 2)).toBe('2 INFO');
    expect(severityCountLabel('info', 1)).toBe('1 INFO');
  });
});
