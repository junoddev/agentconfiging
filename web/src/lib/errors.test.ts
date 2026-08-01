import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/index.js';
import { errorText } from './errors.js';

describe('errorText', () => {
  it('maps each known ApiError kind to its honest line', () => {
    expect(errorText(new ApiError(404, 'notfound', 'x'))).toBe('file not found');
    expect(errorText(new ApiError(403, 'forbidden', 'x'))).toBe('file out of scope');
    expect(errorText(new ApiError(401, 'unauthorized', 'x'))).toBe(
      'session expired — reopen from the CLI',
    );
    expect(errorText(new ApiError(0, 'network', 'x'))).toBe('cannot reach the local server');
  });

  it('falls back for an unmodeled ApiError kind', () => {
    expect(errorText(new ApiError(500, 'server', 'x'))).toBe('could not load file');
  });

  it('falls back for a non-ApiError value', () => {
    expect(errorText(new Error('boom'))).toBe('could not load file');
    expect(errorText('nope')).toBe('could not load file');
    expect(errorText(undefined)).toBe('could not load file');
  });
});
