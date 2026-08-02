/**
 * Registry client tests (agentconfig-0zm.2) — fetch/fs/clock are all injected,
 * so nothing here touches the real network or disk. Covers the resolution
 * order (fresh cache → fetch → stale cache → seed), the trust boundary on both
 * wire and cache, the merge, and the payload security model (checksum, https,
 * size cap, timeout).
 */

import { describe, expect, it } from 'vitest';
import {
  RegistryClient,
  RegistryFetchError,
  RegistryVerificationError,
  mergeCatalog,
  assertFetchableUrl,
  resolveRegistryCacheDir,
  type HttpFetch,
  type HostResolver,
  type HttpResponse,
  type RegistryFs,
} from './client.js';
import { sha256Hex } from './verify.js';
import { loadSeedIndex } from './loader.js';
import type { RegistryEntry } from './schema.js';

const CACHE_DIR = '/cache';
const CACHE_FILE = '/cache/index.json';

/** An in-memory RegistryFs. `files` is inspectable after the run. */
function memFs(seed: Record<string, string> = {}): { fs: RegistryFs; files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  const fs: RegistryFs = {
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    mkdir: async () => {},
  };
  return { fs, files };
}

function httpResponse(
  body: string,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): HttpResponse {
  const headers = init.headers ?? {};
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  const content = 'demo body\n';
  return {
    kind: 'skill',
    name: 'demo',
    description: 'a demo entry',
    version: '1.0.0',
    source: 'test',
    tags: [],
    files: [{ path: '.claude/skills/demo/SKILL.md', content, sha256: sha256Hex(content) }],
    ...overrides,
  };
}

function indexJson(entries: unknown[], version = '1.0.0'): string {
  return JSON.stringify({ version, entries });
}

function cacheEnvelope(fetchedAt: number, entries: unknown[]): string {
  return JSON.stringify({ version: 1, fetchedAt, index: { version: '1.0.0', entries } });
}

const REGISTRY_URL = 'https://registry.example/index.json';

function client(opts: {
  fetch?: HttpFetch;
  files?: Record<string, string>;
  now?: number;
  ttlMs?: number;
  timeoutMs?: number;
  maxFileBytes?: number;
  resolveHost?: HostResolver;
  allowInsecureLocalhost?: boolean;
}): { c: RegistryClient; files: Map<string, string> } {
  const { fs, files } = memFs(opts.files);
  const c = new RegistryClient({
    registryUrl: REGISTRY_URL,
    cacheDir: CACHE_DIR,
    fs,
    fetch: opts.fetch,
    now: () => opts.now ?? 1_000_000,
    ttlMs: opts.ttlMs,
    timeoutMs: opts.timeoutMs,
    maxFileBytes: opts.maxFileBytes,
    resolveHost: opts.resolveHost ?? (async () => ['203.0.113.10']),
    allowInsecureLocalhost: opts.allowInsecureLocalhost,
  });
  return { c, files };
}

const SEED_COUNT = loadSeedIndex().entries.length;

describe('resolution order — catalog', () => {
  it('fresh fetch is validated, merged over seed, and written to cache', async () => {
    const fetchFn: HttpFetch = async () => httpResponse(indexJson([entry()]));
    const { c, files } = client({ fetch: fetchFn });

    const result = await c.loadCatalog();

    expect(result.overlaySource).toBe('fetch');
    expect(result.entries.some((e) => e.kind === 'skill' && e.name === 'demo')).toBe(true);
    // seed is the base layer, so the merged catalog is seed + the new entry.
    expect(result.entries.length).toBe(SEED_COUNT + 1);
    // the validated index was persisted to the cache.
    expect(files.has(CACHE_FILE)).toBe(true);
  });

  it('a fresh cache is used without any network call', async () => {
    let calls = 0;
    const fetchFn: HttpFetch = async () => {
      calls += 1;
      return httpResponse(indexJson([entry()]));
    };
    const now = 1_000_000;
    const { c } = client({
      fetch: fetchFn,
      now,
      ttlMs: 60_000,
      files: { [CACHE_FILE]: cacheEnvelope(now - 1000, [entry({ name: 'from-cache' })]) },
    });

    const result = await c.loadCatalog();

    expect(calls).toBe(0);
    expect(result.overlaySource).toBe('cache');
    expect(result.entries.some((e) => e.name === 'from-cache')).toBe(true);
  });

  it('falls back to a stale cache when the fetch fails', async () => {
    const fetchFn: HttpFetch = async () => {
      throw new Error('network down');
    };
    const now = 1_000_000;
    const { c } = client({
      fetch: fetchFn,
      now,
      ttlMs: 1000,
      files: { [CACHE_FILE]: cacheEnvelope(now - 999_999, [entry({ name: 'stale-cache' })]) },
    });

    const result = await c.loadCatalog();

    expect(result.overlaySource).toBe('cache');
    expect(result.entries.some((e) => e.name === 'stale-cache')).toBe(true);
  });

  it('falls back to the seed (offline floor) when there is no cache', async () => {
    const fetchFn: HttpFetch = async () => {
      throw new Error('offline');
    };
    const { c } = client({ fetch: fetchFn });

    const result = await c.loadCatalog();

    expect(result.overlaySource).toBe('none');
    expect(result.entries.length).toBe(SEED_COUNT);
  });
});

describe('untrusted input — wire and cache are both validated', () => {
  it('a hostile fetched index shape is rejected → falls back to seed', async () => {
    const fetchFn: HttpFetch = async () =>
      httpResponse(JSON.stringify({ version: '1', entries: {} }));
    const { c } = client({ fetch: fetchFn });

    const result = await c.loadCatalog();

    expect(result.overlaySource).toBe('none');
    expect(result.entries.length).toBe(SEED_COUNT);
  });

  it('a tampered cache with a bad top-level shape is treated as no cache', async () => {
    const fetchFn: HttpFetch = async () => {
      throw new Error('offline');
    };
    const now = 1_000_000;
    const { c } = client({
      fetch: fetchFn,
      now,
      files: {
        [CACHE_FILE]: JSON.stringify({ version: 1, fetchedAt: now, index: { entries: 42 } }),
      },
    });

    const result = await c.loadCatalog();

    // bad cache rejected, fetch offline → seed floor.
    expect(result.overlaySource).toBe('none');
    expect(result.entries.length).toBe(SEED_COUNT);
  });

  it('a cache entry whose content does not match its sha256 is dropped', async () => {
    const fetchFn: HttpFetch = async () => {
      throw new Error('offline');
    };
    const now = 1_000_000;
    const tampered = entry({
      name: 'tampered',
      files: [{ path: 'a', content: 'evil', sha256: 'a'.repeat(64) }],
    });
    const { c } = client({
      fetch: fetchFn,
      now,
      files: { [CACHE_FILE]: cacheEnvelope(now, [tampered]) },
    });

    const result = await c.loadCatalog();

    // the cache loaded (fresh) but the checksum-failing entry was filtered out.
    expect(result.overlaySource).toBe('cache');
    expect(result.entries.some((e) => e.name === 'tampered')).toBe(false);
    expect(result.entries.length).toBe(SEED_COUNT);
  });
});

describe('merge — fetched supersedes seed by (kind, name)', () => {
  it('a fetched entry overrides the seed entry with the same key', async () => {
    const override = entry({ kind: 'runtime-template', name: 'cursor-starter', version: '99.0.0' });
    const fetchFn: HttpFetch = async () => httpResponse(indexJson([override]));
    const { c } = client({ fetch: fetchFn });

    const entries = await c.getCatalog();
    const cursor = entries.find(
      (e) => e.kind === 'runtime-template' && e.name === 'cursor-starter',
    );

    expect(cursor?.version).toBe('99.0.0');
  });

  it('mergeCatalog keeps seed entries and overlays by key (pure)', () => {
    const seed = [entry({ name: 'a' }), entry({ name: 'b' })];
    const overlay = [entry({ name: 'b', version: '2.0.0' }), entry({ name: 'c' })];
    const merged = mergeCatalog(seed, overlay);
    expect(merged.map((e) => e.name).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.find((e) => e.name === 'b')?.version).toBe('2.0.0');
  });
});

describe('fetchEntryFiles — payload verification', () => {
  it('returns inlined content when its checksum matches', async () => {
    const { c } = client({});
    const files = await c.fetchEntryFiles(entry());
    expect(files[0]?.content).toBe('demo body\n');
  });

  it('rejects inlined content whose checksum does not match', async () => {
    const bad = entry({ files: [{ path: 'a', content: 'tampered', sha256: 'a'.repeat(64) }] });
    const { c } = client({});
    await expect(c.fetchEntryFiles(bad)).rejects.toBeInstanceOf(RegistryVerificationError);
  });

  it('fetches a url payload over https and verifies its sha256', async () => {
    const payload = 'remote payload\n';
    const sha = sha256Hex(payload);
    let calls = 0;
    const fetchFn: HttpFetch = async () => {
      calls += 1;
      return httpResponse(payload);
    };
    const url = entry({ files: [{ path: 'a', url: 'https://cdn.example/a', sha256: sha }] });
    const { c } = client({ fetch: fetchFn });

    const files = await c.fetchEntryFiles(url);
    expect(files[0]?.content).toBe(payload);
    expect(calls).toBe(1);

    // second call is served from the content-addressed cache — no re-fetch.
    await c.fetchEntryFiles(url);
    expect(calls).toBe(1);
  });

  it('rejects a url payload whose bytes do not match the declared sha256', async () => {
    const fetchFn: HttpFetch = async () => httpResponse('not what was promised');
    const url = entry({
      files: [{ path: 'a', url: 'https://cdn.example/a', sha256: 'b'.repeat(64) }],
    });
    const { c } = client({ fetch: fetchFn });
    await expect(c.fetchEntryFiles(url)).rejects.toBeInstanceOf(RegistryVerificationError);
  });

  it('refuses a non-https payload url', async () => {
    const fetchFn: HttpFetch = async () => httpResponse('x');
    const url = entry({
      files: [{ path: 'a', url: 'http://cdn.example/a', sha256: 'c'.repeat(64) }],
    });
    const { c } = client({ fetch: fetchFn });
    await expect(c.fetchEntryFiles(url)).rejects.toBeInstanceOf(RegistryFetchError);
  });

  it('rejects a payload larger than the size cap', async () => {
    const big = 'x'.repeat(100);
    const fetchFn: HttpFetch = async () => httpResponse(big);
    const url = entry({
      files: [{ path: 'a', url: 'https://cdn.example/a', sha256: sha256Hex(big) }],
    });
    const { c } = client({ fetch: fetchFn, maxFileBytes: 10 });
    await expect(c.fetchEntryFiles(url)).rejects.toBeInstanceOf(RegistryFetchError);
  });

  it('rejects when the content-length header exceeds the cap before reading', async () => {
    const fetchFn: HttpFetch = async () =>
      httpResponse('small', { headers: { 'content-length': '999999' } });
    const url = entry({
      files: [{ path: 'a', url: 'https://cdn.example/a', sha256: 'd'.repeat(64) }],
    });
    const { c } = client({ fetch: fetchFn, maxFileBytes: 10 });
    await expect(c.fetchEntryFiles(url)).rejects.toBeInstanceOf(RegistryFetchError);
  });
});

describe('timeout', () => {
  it('aborts a hanging fetch and falls back to the seed', async () => {
    const hangingFetch: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { c } = client({ fetch: hangingFetch, timeoutMs: 10 });

    const result = await c.loadCatalog();

    expect(result.overlaySource).toBe('none');
    expect(result.entries.length).toBe(SEED_COUNT);
  });
});

describe('assertFetchableUrl', () => {
  it('accepts https', () => {
    expect(() => assertFetchableUrl('https://example.com/x', false)).not.toThrow();
  });

  it('rejects http by default', () => {
    expect(() => assertFetchableUrl('http://example.com/x', false)).toThrow(RegistryFetchError);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd', true)).toThrow(RegistryFetchError);
  });

  it('allows http to localhost only when opted in', () => {
    expect(() => assertFetchableUrl('http://localhost:8080/x', true)).not.toThrow();
    expect(() => assertFetchableUrl('http://evil.example/x', true)).toThrow(RegistryFetchError);
  });

  it('allows public IPv4-mapped IPv6 and blocks private mapped IPv4', () => {
    expect(() => assertFetchableUrl('https://[::ffff:8.8.8.8]/x', false)).not.toThrow();
    expect(() => assertFetchableUrl('https://[::ffff:192.168.1.2]/x', false)).toThrow(
      RegistryFetchError,
    );
  });

  // Incident agentconfig-0zm.7: a malicious registry entry must not turn the
  // payload downloader into a blind request to loopback, LAN, or cloud metadata.
  it.each([
    'https://127.0.0.1/admin',
    'https://10.0.0.8/internal',
    'https://192.168.1.9/private',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/admin',
    'https://[::ffff:127.0.0.1]/admin',
  ])(
    'agentconfig-0zm.7 registry SSRF: refuses hostile payload URL %s before fetch',
    async (url) => {
      let calls = 0;
      const fetchFn: HttpFetch = async () => {
        calls += 1;
        return httpResponse('internal secret');
      };
      const malicious = entry({
        files: [{ path: 'a', url, sha256: sha256Hex('internal secret') }],
      });
      const { c } = client({ fetch: fetchFn });

      await expect(c.fetchEntryFiles(malicious)).rejects.toBeInstanceOf(RegistryFetchError);
      expect(calls).toBe(0);
    },
  );

  it('agentconfig-0zm.7 registry SSRF DNS: refuses a private resolution before fetch', async () => {
    let calls = 0;
    const fetchFn: HttpFetch = async () => {
      calls += 1;
      return httpResponse('internal secret');
    };
    const malicious = entry({
      files: [
        {
          path: 'a',
          url: 'https://attacker.example/payload',
          sha256: sha256Hex('internal secret'),
        },
      ],
    });
    const { c } = client({ fetch: fetchFn, resolveHost: async () => ['169.254.169.254'] });

    await expect(c.fetchEntryFiles(malicious)).rejects.toBeInstanceOf(RegistryFetchError);
    expect(calls).toBe(0);
  });

  it('agentconfig-0zm.7 registry SSRF redirect: validates a private next hop before fetch', async () => {
    const calls: string[] = [];
    const fetchFn: HttpFetch = async (url, init) => {
      calls.push(url);
      expect(init.redirect).toBe('manual');
      return httpResponse('', {
        ok: false,
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data/' },
      });
    };
    const malicious = entry({
      files: [
        {
          path: 'a',
          url: 'https://public.example/payload',
          sha256: sha256Hex('unused'),
        },
      ],
    });
    const { c } = client({ fetch: fetchFn });

    await expect(c.fetchEntryFiles(malicious)).rejects.toBeInstanceOf(RegistryFetchError);
    expect(calls).toEqual(['https://public.example/payload']);
  });

  it('agentconfig-0zm.7 registry SSRF DNS: checks the registry index host before fetch', async () => {
    let calls = 0;
    const { c } = client({
      fetch: async () => {
        calls += 1;
        return httpResponse(indexJson([]));
      },
      resolveHost: async () => ['10.0.0.1'],
    });

    const result = await c.loadCatalog();
    expect(result.overlaySource).toBe('none');
    expect(calls).toBe(0);
  });

  it('preserves opted-in localhost HTTP without DNS resolution', async () => {
    const payload = 'local payload';
    let resolutions = 0;
    const local = entry({
      files: [
        {
          path: 'a',
          url: 'http://localhost:8080/payload',
          sha256: sha256Hex(payload),
        },
      ],
    });
    const { c } = client({
      fetch: async (_url, init) => {
        expect(init.redirect).toBe('manual');
        return httpResponse(payload);
      },
      resolveHost: async () => {
        resolutions += 1;
        return ['127.0.0.1'];
      },
      allowInsecureLocalhost: true,
    });

    await expect(c.fetchEntryFiles(local)).resolves.toEqual([{ path: 'a', content: payload }]);
    expect(resolutions).toBe(0);
  });
});

describe('resolveRegistryCacheDir', () => {
  it('honors AGENTCONFIGING_STATE_DIR', () => {
    const dir = resolveRegistryCacheDir({ AGENTCONFIGING_STATE_DIR: '/custom/state' }, '/home/u');
    expect(dir).toBe('/custom/state/registry-cache');
  });

  it('honors XDG_STATE_HOME', () => {
    const dir = resolveRegistryCacheDir({ XDG_STATE_HOME: '/xdg' }, '/home/u');
    expect(dir).toBe('/xdg/agentconfiging/registry-cache');
  });

  it('falls back to ~/.local/state', () => {
    const dir = resolveRegistryCacheDir({}, '/home/u');
    expect(dir).toBe('/home/u/.local/state/agentconfiging/registry-cache');
  });
});
