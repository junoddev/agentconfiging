import { describe, expect, it } from 'vitest';
import { validatePublishTag } from './validate-publish-tag.mjs';

describe('publish tag validation', () => {
  it('accepts only an exact v-prefixed package version', () => {
    expect(validatePublishTag('refs/tags/v1.2.3', '1.2.3')).toBe('v1.2.3');
  });

  it.each([
    ['refs/tags/v1.2.4', '1.2.3'],
    ['refs/tags/1.2.3', '1.2.3'],
    ['refs/tags/v1.2.3-beta.1', '1.2.3'],
    ['refs/heads/v1.2.3', '1.2.3'],
  ])('rejects ref %s for version %s', (ref, version) => {
    expect(() => validatePublishTag(ref, version)).toThrow();
  });
});
