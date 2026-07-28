import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('ApiClient instance mutations', () => {
  it('POSTs the add-instance body with the bearer token', async () => {
    const fetchImpl = stubFetch({ id: '1', name: 'proj', root: '/p', markers: [], loaded: false });
    const client = new ApiClient('tok', { fetchImpl });
    const summary = await client.addInstance('/p');
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/instances');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ path: '/p' }));
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    expect(summary).toMatchObject({ id: '1', root: '/p' });
  });

  it('POSTs a writeFile dry-run body and returns the preview', async () => {
    const body = { willCreate: true, willModify: false, pathScope: 'project', diff: '+x\n' };
    const fetchImpl = stubFetch(body);
    const client = new ApiClient('tok', { fetchImpl });
    const res = await client.writeFile('.gitignore', 'x\n', true);
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/write');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ path: '.gitignore', content: 'x\n', dryRun: true }));
    expect(res).toEqual(body);
  });

  it('POSTs an applyFix body with findingId + dryRun, omitting instance when absent', async () => {
    const body = { dryRun: true, findingId: 'f', fixKind: 'create-file', edits: [] };
    const fetchImpl = stubFetch(body);
    const client = new ApiClient('tok', { fetchImpl });
    await client.applyFix('f', { dryRun: true });
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/apply-fix');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ findingId: 'f', dryRun: true }));
  });

  it('includes the instance selector in an applyFix body when given', async () => {
    const fetchImpl = stubFetch({ committed: true, findingId: 'f', edits: [] });
    const client = new ApiClient('tok', { fetchImpl });
    await client.applyFix('f', { dryRun: false, instance: 'inst1' });
    const [, init] = firstCall(fetchImpl);
    expect(init.body).toBe(JSON.stringify({ findingId: 'f', dryRun: false, instance: 'inst1' }));
  });

  it('POSTs the scan body and returns hits + stats', async () => {
    const body = {
      hits: [{ root: '/p/a', markers: ['CLAUDE.md'], runtimes: ['claude-code'] }],
      stats: { dirsVisited: 12, truncated: false, skipped: 3 },
    };
    const fetchImpl = stubFetch(body);
    const client = new ApiClient('tok', { fetchImpl });
    const res = await client.scanFolder('/p');
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/instances/scan');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ path: '/p' }));
    expect(res).toEqual(body);
  });

  it('POSTs unload to the encoded instance id (no body)', async () => {
    const fetchImpl = stubFetch({ id: 'a/b', loaded: false });
    const client = new ApiClient('tok', { fetchImpl });
    await client.unloadInstance('a/b');
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/instances/a%2Fb/unload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('DELETEs the encoded instance id', async () => {
    const fetchImpl = stubFetch({ id: 'x', removed: true });
    const client = new ApiClient('tok', { fetchImpl });
    const res = await client.removeInstance('x');
    const [url, init] = firstCall(fetchImpl);
    expect(url).toBe('/api/instances/x');
    expect(init.method).toBe('DELETE');
    expect(res).toEqual({ id: 'x', removed: true });
  });

  it('maps a 400 add to a badrequest ApiError carrying the server message', async () => {
    const fetchImpl = stubFetch({ error: 'not a directory' }, 400);
    const client = new ApiClient('tok', { fetchImpl });
    const err = await client.addInstance('/nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, kind: 'badrequest', message: 'not a directory' });
  });

  it('falls back to HTTP <status> when the error body lacks a message', async () => {
    const fetchImpl = stubFetch({}, 500);
    const client = new ApiClient('tok', { fetchImpl });
    const err = await client.scanFolder('/p').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, kind: 'server', message: 'HTTP 500' });
  });

  it('maps a thrown fetch during a mutation to a network ApiError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const client = new ApiClient('tok', { fetchImpl });
    const err = await client.removeInstance('x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, kind: 'network' });
  });
});

describe('ApiClient default fetch binding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the global fetch with globalThis as `this` (browser fetch is this-sensitive)', async () => {
    // Mimics window.fetch in real browsers: throws "Illegal invocation" when
    // invoked with a foreign `this` (e.g. the ApiClient instance).
    function thisSensitiveFetch(this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, version: '1.0.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    vi.stubGlobal('fetch', thisSensitiveFetch);
    const client = new ApiClient('tok'); // no fetchImpl: uses the global default
    await expect(client.getHealth()).resolves.toMatchObject({ ok: true });
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
