import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { FileContent, RedactionSpan } from '../api/index.js';
import { REDACTION_RE, hasRedactionMarks, isRedactedFile, renderRedacted } from './redacted.js';

describe('hasRedactionMarks / REDACTION_RE', () => {
  it('detects [REDACTED:*] placeholder marks', () => {
    expect(hasRedactionMarks('token = [REDACTED:openai]')).toBe(true);
    expect(hasRedactionMarks('nothing secret here')).toBe(false);
    expect(hasRedactionMarks('an array literal [0] is not a mark')).toBe(false);
  });

  it('exports the underlying pattern', () => {
    expect(REDACTION_RE.test('[REDACTED:github]')).toBe(true);
  });
});

describe('isRedactedFile', () => {
  const file = (
    content: string,
    spans: RedactionSpan[],
  ): Pick<FileContent, 'content' | 'spans'> => ({
    content,
    spans,
  });

  it('is redacted when the server marked spans', () => {
    expect(isRedactedFile(file('safe text', [{ start: 0, end: 4, id: 'x' }]))).toBe(true);
  });

  it('is redacted when the text carries a [REDACTED:*] mark (no spans)', () => {
    expect(isRedactedFile(file('key = [REDACTED:aws]', []))).toBe(true);
  });

  it('is not redacted with no spans and no marks', () => {
    expect(isRedactedFile(file('plain content', []))).toBe(false);
  });
});

describe('renderRedacted', () => {
  const isMark = (n: unknown): n is ReactElement<{ className?: string }> =>
    typeof n === 'object' && n !== null && (n as ReactElement).type === 'mark';

  it('returns the whole content as one text node when there are no spans', () => {
    const nodes = renderRedacted('hello world', []);
    expect(nodes).toEqual(['hello world']);
  });

  it('interleaves verbatim text with a styled mark per span', () => {
    const nodes = renderRedacted('a [REDACTED:x] b', [{ start: 2, end: 14, id: 'x' }]);
    // ['a ', <mark>, ' b']
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toBe('a ');
    expect(isMark(nodes[1])).toBe(true);
    expect(nodes[2]).toBe(' b');
  });

  it('uses the default mark class, overridable per caller', () => {
    const [mark] = renderRedacted('[REDACTED:x]', [{ start: 0, end: 12, id: 'x' }]);
    expect(isMark(mark) && mark.props.className).toBe('redact-mark');
    const [mark2] = renderRedacted(
      '[REDACTED:x]',
      [{ start: 0, end: 12, id: 'x' }],
      'artifact__redact',
    );
    expect(isMark(mark2) && mark2.props.className).toBe('artifact__redact');
  });

  it('defensively skips a malformed (out-of-range / overlapping) span', () => {
    const nodes = renderRedacted('short', [{ start: 0, end: 999, id: 'x' }]);
    expect(nodes).toEqual(['short']);
  });
});
