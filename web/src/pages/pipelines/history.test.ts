import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../api/types.js';
import {
  clampStep,
  formatClock,
  formatDuration,
  renderSegments,
  replaySteps,
  runStatusModifier,
  statusCountsLabel,
} from './history.js';

describe('formatDuration', () => {
  it('formats sub-second, seconds, and minutes terse', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(820)).toBe('820ms');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(65_000)).toBe('1m 05s');
  });
  it('returns "" for undefined / invalid', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});

describe('formatClock', () => {
  it('returns a non-empty label for a real timestamp and "" for junk', () => {
    expect(formatClock(Date.UTC(2026, 0, 1)).length).toBeGreaterThan(0);
    expect(formatClock(Number.NaN)).toBe('');
  });
});

describe('statusCountsLabel', () => {
  it('joins non-zero categories in a fixed order', () => {
    expect(statusCountsLabel({ ok: 3, error: 1, pending: 0, running: 0, total: 4 })).toBe(
      '3 ok · 1 error',
    );
    expect(statusCountsLabel({ ok: 0, error: 0, pending: 2, running: 1, total: 3 })).toBe(
      '1 running · 2 pending',
    );
  });
  it('is "—" when there are no nodes', () => {
    expect(statusCountsLabel({ ok: 0, error: 0, pending: 0, running: 0, total: 0 })).toBe('—');
  });
});

describe('runStatusModifier', () => {
  it('maps a run status to its css modifier', () => {
    expect(runStatusModifier('ok')).toBe('pipeline-run--ok');
    expect(runStatusModifier('error')).toBe('pipeline-run--error');
    expect(runStatusModifier('running')).toBe('pipeline-run--running');
  });
});

describe('renderSegments', () => {
  it('splits redacted text into plain + mark segments', () => {
    // "key=[REDACTED:aws_access_key] end" — the mark spans [4, 30).
    const text = 'key=[REDACTED:aws_access_key] end';
    const segs = renderSegments(text, [{ start: 4, end: 29, id: 'aws_access_key' }]);
    expect(segs).toEqual([
      { text: 'key=', redacted: false },
      { text: '[REDACTED:aws_access_key]', redacted: true, id: 'aws_access_key' },
      { text: ' end', redacted: false },
    ]);
  });
  it('is defensive against out-of-range / inverted spans', () => {
    expect(renderSegments('abc', [{ start: 5, end: 9, id: 'x' }])).toEqual([
      { text: 'abc', redacted: false },
    ]);
    expect(renderSegments('abc', [{ start: 2, end: 1, id: 'x' }])).toEqual([
      { text: 'abc', redacted: false },
    ]);
  });
  it('renders plain text with no spans as a single segment', () => {
    expect(renderSegments('hello', [])).toEqual([{ text: 'hello', redacted: false }]);
  });
});

const RUN: RunSnapshot = {
  runId: '11111111-1111-1111-1111-111111111111',
  pipelineId: 'demo',
  status: 'error',
  startedAt: 1000,
  finishedAt: 1200,
  nodes: {
    a: { nodeName: 'in', status: 'ok', output: { text: 'seed', spans: [] } },
    b: {
      nodeName: 'sh',
      status: 'error',
      output: {
        text: 'boom [REDACTED:aws_access_key]',
        spans: [{ start: 5, end: 30, id: 'aws_access_key' }],
      },
      error: 'exit 1',
    },
  },
};

describe('replaySteps', () => {
  it('walks a run in insertion (execution) order, surfacing redacted output', () => {
    const steps = replaySteps(RUN);
    expect(steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(steps[0]).toMatchObject({ nodeName: 'in', status: 'ok', outputText: 'seed' });
    expect(steps[1]).toMatchObject({ nodeName: 'sh', status: 'error', error: 'exit 1' });
    expect(steps[1]!.outputText).toContain('[REDACTED:aws_access_key]');
    expect(steps[1]!.outputSpans).toHaveLength(1);
  });
  it('returns [] for an undefined run and defaults missing output to ""', () => {
    expect(replaySteps(undefined)).toEqual([]);
    const bare: RunSnapshot = { ...RUN, nodes: { a: { nodeName: 'x', status: 'pending' } } };
    expect(replaySteps(bare)[0]).toMatchObject({ outputText: '', outputSpans: [] });
  });
});

describe('clampStep', () => {
  it('clamps an index into range or -1 when empty', () => {
    expect(clampStep(0, 0)).toBe(-1);
    expect(clampStep(-3, 4)).toBe(0);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(2, 4)).toBe(2);
  });
});
