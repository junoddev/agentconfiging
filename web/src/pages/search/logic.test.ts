import { describe, expect, it } from 'vitest';
import type { RedactionSpan, SearchHit } from '../../api/types.js';
import { coverageLine, formatWhen, hitLabel, sessionRefHash, snippetSegments } from './logic.js';

describe('snippetSegments', () => {
  it('splits a redacted snippet into plain + marked runs', () => {
    // "key [REDACTED:aws] now" with the mark spanning offsets 4..17.
    const snippet = 'key [REDACTED:aws] now';
    const spans: RedactionSpan[] = [{ start: 4, end: 18, id: 'aws' as RedactionSpan['id'] }];
    const segs = snippetSegments(snippet, spans);
    expect(segs).toEqual([
      { text: 'key ', redacted: false },
      { text: '[REDACTED:aws]', redacted: true, id: 'aws' },
      { text: ' now', redacted: false },
    ]);
  });

  it('returns the whole snippet as one plain segment when there are no spans', () => {
    expect(snippetSegments('plain text', [])).toEqual([{ text: 'plain text', redacted: false }]);
  });

  it('skips out-of-range / inverted / overlapping spans defensively', () => {
    const snippet = 'abcdef';
    const spans: RedactionSpan[] = [
      { start: 4, end: 2, id: 'x' as RedactionSpan['id'] }, // inverted
      { start: 2, end: 99, id: 'y' as RedactionSpan['id'] }, // out of range
    ];
    expect(snippetSegments(snippet, spans)).toEqual([{ text: 'abcdef', redacted: false }]);
  });
});

describe('sessionRefHash', () => {
  it('deep-links to the replay page with an encoded session id', () => {
    expect(sessionRefHash({ sessionId: 'a/b c' })).toBe('#/sessions?session=a%2Fb%20c');
  });
});

describe('hitLabel', () => {
  it('labels a hit by role and 1-based message index', () => {
    expect(hitLabel({ role: 'assistant', messageIndex: 3 })).toBe('assistant · #4');
    expect(hitLabel({ role: '', messageIndex: 0 })).toBe('message · #1');
  });
});

describe('coverageLine', () => {
  it('summarizes indexed vs total with separators', () => {
    expect(coverageLine({ sessions: 42, messages: 1204 }, 60)).toBe(
      '42 of 60 sessions · 1,204 messages indexed',
    );
  });
});

describe('formatWhen', () => {
  it('is empty for absent/unparseable timestamps', () => {
    expect(formatWhen(undefined)).toBe('');
    expect(formatWhen('')).toBe('');
    expect(formatWhen('not-a-date')).toBe('');
  });
  it('formats a valid ISO timestamp', () => {
    expect(formatWhen('2026-07-26T09:05:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

// Type-only sanity: SearchHit fields feed the helpers above.
const _sample: SearchHit = {
  sessionId: 's',
  messageIndex: 0,
  role: 'user',
  snippet: 'x',
  spans: [],
};
void _sample;
