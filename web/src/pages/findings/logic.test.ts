import { describe, expect, it } from 'vitest';
import type { GlobalEntry, ReportFinding } from '../../api/types.js';
import {
  canApply,
  countBySeverity,
  filterFindings,
  globalFindingRows,
  globalTallyLine,
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

function globalEntry(over: Partial<GlobalEntry> = {}): GlobalEntry {
  return {
    root: '/Users/x/.claude',
    dir: '.claude',
    agents: [],
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
    ...over,
  };
}

describe('canApply', () => {
  it('offers APPLY only for project findings with a machine fix', () => {
    expect(canApply(SAMPLE[0]!, 'project')).toBe(true);
    expect(canApply(SAMPLE[1]!, 'project')).toBe(false);
  });

  it('NEVER offers APPLY for a global finding, even with hasFix set', () => {
    expect(canApply(SAMPLE[0]!, 'global')).toBe(false);
    expect(canApply({ hasFix: true }, 'global')).toBe(false);
  });
});

describe('globalFindingRows', () => {
  it('flattens entries into root-annotated rows, entry order then finding order', () => {
    const rows = globalFindingRows([
      globalEntry({ root: '/u/.claude', findings: [SAMPLE[0]!, SAMPLE[2]!] }),
      globalEntry({ root: '/u/.cursor', dir: '.cursor', findings: [SAMPLE[3]!] }),
    ]);
    expect(rows).toEqual([
      { root: '/u/.claude', finding: SAMPLE[0]! },
      { root: '/u/.claude', finding: SAMPLE[2]! },
      { root: '/u/.cursor', finding: SAMPLE[3]! },
    ]);
  });

  it('is empty for no entries or finding-free entries — page renders unchanged', () => {
    expect(globalFindingRows([])).toEqual([]);
    expect(globalFindingRows([globalEntry()])).toEqual([]);
  });
});

describe('globalTallyLine', () => {
  it('tallies the global layer in severity order, non-zero bands only', () => {
    expect(globalTallyLine(SAMPLE)).toBe('2 ERRORS · 1 WARNING · 1 INFO');
    expect(globalTallyLine([SAMPLE[0]!, SAMPLE[3]!])).toBe('1 ERROR · 1 INFO');
  });

  it('is empty when the global layer has no findings', () => {
    expect(globalTallyLine([])).toBe('');
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
