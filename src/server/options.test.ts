import { describe, expect, it } from 'vitest';
import { LOOPBACK_HOST, resolveServerOptions } from './options.js';

describe('resolveServerOptions', () => {
  it('defaults to loopback with a random (OS-assigned) port', () => {
    expect(resolveServerOptions()).toEqual({ host: LOOPBACK_HOST, port: 0 });
  });

  it('accepts an explicit port but never changes the host', () => {
    expect(resolveServerOptions({ port: 4321 })).toEqual({ host: '127.0.0.1', port: 4321 });
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(() => resolveServerOptions({ port: -1 })).toThrow(RangeError);
    expect(() => resolveServerOptions({ port: 65536 })).toThrow(RangeError);
    expect(() => resolveServerOptions({ port: 1.5 })).toThrow(RangeError);
  });
});
