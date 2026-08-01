import { describe, expect, it } from 'vitest';
import {
  blockLabel,
  filterSessions,
  formatDuration,
  formatUsageCost,
  formatUsageTokens,
  formatWhen,
  messageLabel,
  normalizeTag,
  renderSegments,
  sessionToMarkdown,
  shortId,
  usageCostTitle,
} from './logic.js';
import type {
  ReplayMessage,
  SessionDetail,
  SessionSummary,
  UsageSummary,
} from '../../api/types.js';

const unknownUsage: UsageSummary = {
  tokens: {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  },
  messagesWithUsage: 0,
  completeUsageMessages: 0,
  partialUsageMessages: 0,
  assistantMessagesWithoutUsage: 0,
  cost: { status: 'unknown', currency: 'USD', pricedMessages: 0, unpricedMessages: 0 },
};

const knownUsage: UsageSummary = {
  tokens: {
    inputTokens: 1000,
    outputTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 1200,
  },
  messagesWithUsage: 1,
  completeUsageMessages: 1,
  partialUsageMessages: 0,
  assistantMessagesWithoutUsage: 0,
  cost: {
    status: 'known',
    currency: 'USD',
    amountUsd: 0.006,
    rateSource: 'anthropic-public-pricing-standard-usd-per-mtok-2026-07-26',
    pricedMessages: 1,
    unpricedMessages: 0,
  },
};

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
    usage: knownUsage,
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
    expect(md).toContain('- tokens: 1,200');
    expect(md).toContain('- estimated cost: <$0.01');
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

describe('shortId', () => {
  it('trims a long id to its first 8 chars and keeps short ids whole', () => {
    expect(shortId('a1f3c9d2-4b7e-4e21-9c15-000000000000')).toBe('a1f3c9d2');
    expect(shortId('ab12')).toBe('ab12');
  });
});

describe('filterSessions', () => {
  const make = (over: Partial<SessionSummary>): SessionSummary => ({
    id: 'id-1',
    runtime: 'claude',
    title: '',
    cwd: '',
    messageCount: 0,
    live: false,
    tags: [],
    usage: unknownUsage,
    ...over,
  });
  const sessions = [
    make({ id: 'aaa', title: 'Refactor auth', cwd: '/repo/api' }),
    make({ id: 'bbb', title: 'Fix webhook', cwd: '/repo/web', tags: ['urgent'] }),
  ];

  it('matches on id, title, cwd, and tags, case-insensitively', () => {
    expect(filterSessions(sessions, 'AUTH').map((s) => s.id)).toEqual(['aaa']);
    expect(filterSessions(sessions, 'bbb').map((s) => s.id)).toEqual(['bbb']);
    expect(filterSessions(sessions, '/repo/web').map((s) => s.id)).toEqual(['bbb']);
    expect(filterSessions(sessions, 'urgent').map((s) => s.id)).toEqual(['bbb']);
  });

  it('returns a copy of everything for a blank query and [] for no match', () => {
    const all = filterSessions(sessions, '   ');
    expect(all).toEqual(sessions);
    expect(all).not.toBe(sessions);
    expect(filterSessions(sessions, 'zzz')).toEqual([]);
  });
});

describe('usage formatting', () => {
  it('keeps absent usage unknown', () => {
    expect(formatUsageTokens(unknownUsage)).toBe('—');
    expect(formatUsageCost(unknownUsage)).toBe('unknown');
    expect(usageCostTitle(unknownUsage)).toBe('no usage blocks');
  });

  it('formats known and partial session cost states', () => {
    expect(formatUsageTokens(knownUsage)).toBe('1,200');
    expect(formatUsageCost(knownUsage)).toBe('<$0.01');
    expect(usageCostTitle(knownUsage)).toBe('token-derived estimate');

    expect(
      usageCostTitle({
        ...knownUsage,
        assistantMessagesWithoutUsage: 1,
        cost: { ...knownUsage.cost, status: 'partial', unpricedMessages: 1 },
      }),
    ).toBe('2 unpriced messages');
  });
});
