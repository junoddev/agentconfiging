import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client.js';

/** A fetch stub returning `body` as JSON with `status`, capturing calls. */
function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** The [url, init] of the first recorded fetch call (throws if none). */
function firstCall(fetchImpl: typeof fetch): [string, RequestInit] {
  const { calls } = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock;
  const first = calls[0];
  if (!first) throw new Error('fetch was not called');
  return first;
}

describe('ApiClient URL + header construction', () => {
  it('sends the bearer token on every request', async () => {
    const fetchImpl = stubFetch({ ok: true, version: '1.0.0' });
    const client = new ApiClient('tok', { fetchImpl });
    await client.getHealth();
    const [, init] = firstCall(fetchImpl);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('builds the report URL with an encoded instance selector', async () => {
    const fetchImpl = stubFetch({});
    const client = new ApiClient('tok', { fetchImpl });
    await client.getReport('a/b');
    const [url] = firstCall(fetchImpl);
    expect(url).toBe('/api/report?instance=a%2Fb');
  });

  it('omits the selector when no instance is given', async () => {
    const fetchImpl = stubFetch({});
    const client = new ApiClient('tok', { fetchImpl });
    await client.getReport();
    const [url] = firstCall(fetchImpl);
    expect(url).toBe('/api/report');
  });

  it('encodes the file path', async () => {
    const fetchImpl = stubFetch({ path: 'x', content: '', pathScope: 'project' });
    const client = new ApiClient('tok', { fetchImpl });
    await client.getFile('.claude/settings.json');
    const [url] = firstCall(fetchImpl);
    expect(url).toBe('/api/file?path=.claude%2Fsettings.json');
  });

  it('honors a baseUrl prefix', async () => {
    const fetchImpl = stubFetch({ instances: [] });
    const client = new ApiClient('tok', { fetchImpl, baseUrl: 'http://127.0.0.1:9' });
    await client.getInstances();
    const [url] = firstCall(fetchImpl);
    expect(url).toBe('http://127.0.0.1:9/api/instances');
  });

  it('unwraps the instances array', async () => {
    const fetchImpl = stubFetch({ instances: [{ id: '1' }] });
    const client = new ApiClient('tok', { fetchImpl });
    await expect(client.getInstances()).resolves.toEqual([{ id: '1' }]);
  });
});

describe('ApiClient error mapping', () => {
  it('maps 401 to an unauthorized ApiError', async () => {
    const client = new ApiClient('tok', { fetchImpl: stubFetch({ error: 'unauthorized' }, 401) });
    await expect(client.getReport()).rejects.toMatchObject({ status: 401, kind: 'unauthorized' });
  });

  it('maps 404 to notfound', async () => {
    const client = new ApiClient('tok', { fetchImpl: stubFetch({}, 404) });
    await expect(client.getReport('x')).rejects.toMatchObject({ status: 404, kind: 'notfound' });
  });

  it('maps 5xx to server', async () => {
    const client = new ApiClient('tok', { fetchImpl: stubFetch({}, 500) });
    await expect(client.getInstances()).rejects.toMatchObject({ status: 500, kind: 'server' });
  });

  it('maps a thrown fetch to a network ApiError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const client = new ApiClient('tok', { fetchImpl });
    const err = await client.getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, kind: 'network' });
  });
});
