import { describe, expect, it } from 'vitest';
import {
  blockLabel,
  formatDuration,
  formatWhen,
  messageLabel,
  normalizeTag,
  renderSegments,
  sessionToMarkdown,
} from './logic.js';
import type { ReplayMessage, SessionDetail } from '../../api/types.js';

describe('renderSegments', () => {
  it('splits redacted content into plain + mark segments', () => {
    const content = 'use [REDACTED:openai] now';
    const spans = [{ start: 4, end: 21, id: 'openai' }];
    const segs = renderSegments(content, spans);
    expect(segs).toEqual([
      { text: 'use ', redacted: false },
      { text: '[REDACTED:openai]', redacted: true, id: 'openai' },
      { text: ' now', redacted: false },
    ]);
  });

  it('returns the whole string as one plain segment when there are no spans', () => {
    expect(renderSegments('hello', [])).toEqual([{ text: 'hello', redacted: false }]);
  });

  it('skips out-of-range, inverted, and overlapping spans defensively', () => {
    const content = 'abcdef';
    const spans = [
      { start: 1, end: 3, id: 'a' },
      { start: 2, end: 4, id: 'b' }, // overlaps the previous — dropped
      { start: 5, end: 99, id: 'c' }, // end past content — dropped
      { start: 4, end: 4, id: 'd' }, // empty — dropped
    ];
    const segs = renderSegments(content, spans);
    expect(segs).toEqual([
      { text: 'a', redacted: false },
      { text: 'bc', redacted: true, id: 'a' },
      { text: 'def', redacted: false },
    ]);
  });
});

describe('labels', () => {
  it('labels blocks by kind', () => {
    expect(blockLabel({ kind: 'text' })).toBe('text');
    expect(blockLabel({ kind: 'tool_use', name: 'Bash' })).toBe('tool · Bash');
    expect(blockLabel({ kind: 'tool_use' })).toBe('tool');
    expect(blockLabel({ kind: 'tool_result' })).toBe('tool result');
    expect(blockLabel({ kind: 'unknown', blockType: 'weird' })).toBe('weird');
  });

  it('annotates subagent and meta messages', () => {
    const base: ReplayMessage = { role: 'user', isSidechain: false, isMeta: false, blocks: [] };
    expect(messageLabel(base)).toBe('user');
    expect(messageLabel({ ...base, isSidechain: true })).toBe('user · subagent');
    expect(messageLabel({ ...base, isMeta: true })).toBe('user · meta');
  });
});

describe('formatters', () => {
  it('formats durations terse', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(200_000)).toBe('3m 20s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
  });

  it('formats timestamps, empty for bad input', () => {
    expect(formatWhen(undefined)).toBe('');
    expect(formatWhen('not-a-date')).toBe('');
    expect(formatWhen('2026-07-26T12:34:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('normalizes tags (trim + bound)', () => {
    expect(normalizeTag('  hi  ')).toBe('hi');
    expect(normalizeTag('x'.repeat(200)).length).toBe(64);
  });
});

describe('sessionToMarkdown', () => {
  const detail: SessionDetail = {
    id: 'sess-1',
    runtime: 'claude',
    title: 'My Run',
    cwd: '/home/user/proj',
    startedAt: '2026-07-26T12:00:00.000Z',
    endedAt: '2026-07-26T12:05:00.000Z',
    messageCount: 3,
    offset: 0,
    limit: 200,
    live: false,
    tags: ['urgent'],
    messages: [
      {
        role: 'user',
        isSidechain: false,
        isMeta: false,
        blocks: [{ kind: 'text', text: 'deploy [REDACTED:aws_access_key]', spans: [] }],
      },
      {
        role: 'assistant',
        isSidechain: false,
        isMeta: false,
        blocks: [
          { kind: 'thinking', text: 'hmm', spans: [] },
          { kind: 'tool_use', name: 'Bash' },
          { kind: 'tool_result', text: 'done', spans: [] },
        ],
      },
      {
        role: 'user',
        isSidechain: true,
        isMeta: false,
        blocks: [{ kind: 'text', text: 'sub', spans: [] }],
      },
    ],
  };

  it('emits redacted markdown covering the loaded messages', () => {
    const md = sessionToMarkdown(detail);
    expect(md).toContain('# My Run');
    expect(md).toContain('- tags: urgent');
    expect(md).toContain('[REDACTED:aws_access_key]');
    expect(md).toContain('## user');
    expect(md).toContain('## user · subagent');
    expect(md).toContain('**tool_use** `Bash`');
    expect(md).toContain('all 3 messages');
  });

  it('annotates a windowed export as partial', () => {
    const md = sessionToMarkdown({ ...detail, messageCount: 50, offset: 0 });
    expect(md).toContain('messages 1–3 of 50');
  });
});
