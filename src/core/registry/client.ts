/**
 * Registry client (SPEC §4.5, agentconfig-0zm.2) — fetch + cache + checksum.
 *
 * This is the I/O-BEARING registry module (like scanner.ts is the I/O-bearing
 * engine module): it does network (fetch the external index + payloads) and
 * filesystem (a local cache). Every I/O seam — fetch, fs, and the clock — is
 * INJECTABLE so the resolution logic is unit-testable with zero real I/O. The
 * trust boundary itself stays in the pure foundation (parseRegistryIndex,
 * verifyEntry): the client never re-implements validation, it only decides
 * WHERE bytes come from and re-runs the validators on everything.
 *
 * Registry content — fetched OR cached — is UNTRUSTED input. The cache file is
 * a local file that could be tampered, so it is validated on read exactly like
 * the wire. Nothing is ever executed; payloads are only hashed and compared.
 *
 * Resolution order for the effective catalog (SPEC §4.5, seed/README):
 *   1. Fresh cache — if a cached index is within the TTL, use it (no network).
 *   2. Fetch — otherwise fetch the external index over HTTPS, validate it, and
 *      write it to the cache.
 *   3. Stale cache — if the fetch fails/offline, fall back to the last cached
 *      index even if stale (better than nothing).
 *   4. Seed — if there is no cache at all, the in-package seed is the offline
 *      floor (loadSeedIndex, always available, zero I/O).
 * The seed is ALWAYS the base layer; the resolved overlay (fetch or cache) is
 * merged on top, keyed by (kind, name), overlay superseding seed.
 *
 * Security model:
 *   - HTTPS only. Actual fetches reject any non-https scheme (the validator
 *     already restricts entry urls to http(s); the client tightens that to
 *     https, allowing http only for localhost when explicitly opted in for
 *     local testing).
 *   - Checksum. url-bearing payloads are verified against the entry's sha256
 *     at fetch time (sha256Hex); a mismatch REJECTS the file. Content-bearing
 *     entries carrying a sha that does not match their bytes are dropped from
 *     the validated overlay (verifyEntry) so a tampered index/cache cannot
 *     smuggle content.
 *   - Size caps. Index and payload downloads are byte-capped (content-length
 *     header + measured body) so a hostile endpoint cannot exhaust memory.
 *   - Timeouts. Every fetch is bounded by an AbortController timeout so a slow
 *     or hanging endpoint cannot stall the client.
 *   - Bounded fetch surface: only the configured registry url and entry urls
 *     from a validated index (themselves capped + timed). Literal loopback,
 *     private, link-local, unspecified, and multicast IP hosts are refused so
 *     a compromised registry cannot turn payload fetching into an SSRF probe.
 *   - Content-addressed payload cache. Payloads are cached under their sha256
 *     (a safe, self-verifying cache key); a cached payload whose bytes no
 *     longer hash to its key is ignored and re-fetched.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { RegistryEntry, RegistryFile, RegistryIndex } from './schema.js';
import { parseRegistryIndex } from './validate.js';
import { verifyEntry, sha256Hex } from './verify.js';
import { loadSeedIndex } from './loader.js';

/** Documented placeholder for the external registry (the repo does not exist
 * yet, so this fails to resolve in practice — the client falls back to seed). */
export const DEFAULT_REGISTRY_URL = 'https://registry.agentconfig.ing/index.json';

/** Cache freshness window: a cached index younger than this skips the network. */
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Per-request timeout; a fetch that has not settled by now is aborted. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Byte cap on the index download (roomier than the payload cap). */
export const DEFAULT_MAX_INDEX_BYTES = 5_000_000;

/** Byte cap on one payload download — matches the schema's inlined-content cap. */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/** Cache-envelope schema version (the wrapper around the cached index). */
const CACHE_VERSION = 1;

/** Minimal structural subset of the fetch Response the client consumes. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** Streaming body. Production responses always provide this so the byte cap
   * is enforced before the complete response can be allocated. */
  readonly body?: AsyncIterable<Uint8Array | string>;
  text(): Promise<string>;
  discard?(): void;
}

/** Injectable fetch — `globalThis.fetch` satisfies this by structure. */
export type HttpFetch = (
  url: string,
  init: {
    signal: AbortSignal;
    redirect: 'manual';
    resolvedAddress?: string;
    headers?: Record<string, string>;
  },
) => Promise<HttpResponse>;

/** DNS seam used immediately before each connection attempt. */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

/** Injectable filesystem seam — only the three operations the cache needs. */
export interface RegistryFs {
  /** Read a file as utf8; rejects when the file is absent. */
  readFile(filePath: string): Promise<string>;
  /** Write a file as utf8 (parent dir already ensured via mkdir). */
  writeFile(filePath: string, data: string): Promise<void>;
  /** Create a directory recursively (idempotent). */
  mkdir(dirPath: string): Promise<void>;
}

/** Which overlay layer resolved the catalog (for diagnostics/tests). */
export type OverlaySource = 'fetch' | 'cache' | 'none';

export interface CatalogResult {
  /** Seed merged with the resolved overlay, keyed by (kind, name). */
  entries: RegistryEntry[];
  /** The layer that supplied the overlay (or 'none' → seed-only). */
  overlaySource: OverlaySource;
}

/** A fully resolved, checksum-verified file ready for the install flow. */
export interface ResolvedFile {
  path: string;
  content: string;
}

export interface RegistryClientOptions {
  /** External index url. Defaults to DEFAULT_REGISTRY_URL. */
  registryUrl?: string;
  /** Cache directory. Defaults to the XDG state registry-cache dir. */
  cacheDir?: string;
  /** Fetch seam. Defaults to global fetch. */
  fetch?: HttpFetch;
  /** DNS seam. All returned addresses must be public before fetch is called. */
  resolveHost?: HostResolver;
  /** Filesystem seam. Defaults to node:fs/promises. */
  fs?: RegistryFs;
  /** Clock seam (epoch ms). Defaults to Date.now. */
  now?: () => number;
  /** Cache freshness window in ms. */
  ttlMs?: number;
  /** Per-fetch timeout in ms. */
  timeoutMs?: number;
  /** Byte cap on the index download. */
  maxIndexBytes?: number;
  /** Byte cap on one payload download. */
  maxFileBytes?: number;
  /** Allow http (not https) only for localhost — local registry testing. */
  allowInsecureLocalhost?: boolean;
}

/** A fetch/scheme/size/timeout failure — always caught and degraded to a
 * fallback for the index; surfaced to the caller for payload resolution. */
export class RegistryFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryFetchError';
  }
}

/** A checksum mismatch on a fetched or inlined payload — the file is rejected. */
export class RegistryVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryVerificationError';
  }
}

/**
 * Cache directory for the fetched registry. Mirrors the workspace.ts / logs.ts
 * convention (AGENTCONFIGING_STATE_DIR override → $XDG_STATE_HOME →
 * ~/.local/state), then `agentconfiging/registry-cache`. Re-implemented here
 * rather than imported so src/core never depends on src/cli.
 */
export function resolveRegistryCacheDir(
  env: Record<string, string | undefined>,
  homeDir: string,
): string {
  const override = env['AGENTCONFIGING_STATE_DIR'];
  let stateDir: string;
  if (override !== undefined && override.trim() !== '') {
    stateDir = path.resolve(override);
  } else {
    const xdg = env['XDG_STATE_HOME'];
    const stateHome =
      xdg !== undefined && xdg.trim() !== '' ? xdg : path.join(homeDir, '.local', 'state');
    stateDir = path.join(stateHome, 'agentconfiging');
  }
  return path.join(stateDir, 'registry-cache');
}

/** Enforce https-only fetches (http allowed only for localhost when opted in). */
export function assertFetchableUrl(rawUrl: string, allowInsecureLocalhost: boolean): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RegistryFetchError(`invalid url: ${rawUrl}`);
  }
  if (url.protocol === 'http:' && allowInsecureLocalhost && isLocalhost(url.hostname)) return;
  if (isBlockedRegistryHost(url.hostname)) {
    throw new RegistryFetchError(`refusing private or local url: ${rawUrl}`);
  }
  if (url.protocol === 'https:') return;
  throw new RegistryFetchError(`refusing non-https url: ${rawUrl}`);
}

export function isBlockedRegistryHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const version = net.isIP(host);
  if (version === 4) {
    const value = ipv4Value(host);
    return IPV4_NON_PUBLIC.some(([network, bits]) => inIpv4Cidr(value, network, bits));
  }
  if (version === 6) {
    const mapped = mappedIpv4(host);
    if (mapped !== null) return isBlockedRegistryHost(mapped);
    const value = ipv6Value(host);
    // Public IPv6 destinations are global-unicast (2000::/3), excluding the
    // IANA documentation and special-purpose subnets below.
    return (
      !inIpv6Cidr(value, ipv6Value('2000::'), 3) ||
      inIpv6Cidr(value, ipv6Value('2001:db8::'), 32) ||
      inIpv6Cidr(value, ipv6Value('2001:2::'), 48) ||
      inIpv6Cidr(value, ipv6Value('2001:10::'), 28)
    );
  }
  return false;
}

const IPV4_NON_PUBLIC: ReadonlyArray<readonly [number, number]> = [
  [ipv4Value('0.0.0.0'), 8],
  [ipv4Value('10.0.0.0'), 8],
  [ipv4Value('100.64.0.0'), 10],
  [ipv4Value('127.0.0.0'), 8],
  [ipv4Value('169.254.0.0'), 16],
  [ipv4Value('172.16.0.0'), 12],
  [ipv4Value('192.0.0.0'), 24],
  [ipv4Value('192.0.2.0'), 24],
  [ipv4Value('192.88.99.0'), 24],
  [ipv4Value('192.168.0.0'), 16],
  [ipv4Value('198.18.0.0'), 15],
  [ipv4Value('198.51.100.0'), 24],
  [ipv4Value('203.0.113.0'), 24],
  [ipv4Value('224.0.0.0'), 3],
];

function ipv4Value(host: string): number {
  return host.split('.').reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0;
}

function inIpv4Cidr(value: number, network: number, bits: number): boolean {
  const divisor = 2 ** (32 - bits);
  return Math.floor(value / divisor) === Math.floor(network / divisor);
}

function ipv6Value(host: string): bigint {
  const [left = '', right = ''] = host.toLowerCase().split('::');
  const leftParts = left === '' ? [] : left.split(':');
  const rightParts = right === '' ? [] : right.split(':');
  const parts = [
    ...leftParts,
    ...Array(8 - leftParts.length - rightParts.length).fill('0'),
    ...rightParts,
  ];
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function inIpv6Cidr(value: bigint, network: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === network >> shift;
}

/** Decode both dotted and canonical-hex IPv4-mapped IPv6 spellings. */
function mappedIpv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const dottedAddress = dotted?.[1];
  if (dottedAddress !== undefined && net.isIP(dottedAddress) === 4) return dottedAddress;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return null;
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isLocalhost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Merge a seed entry list with an overlay, keyed by (kind, name). Seed entries
 * form the base; an overlay entry supersedes the seed entry with the same key.
 * Pure — no I/O — so the merge is independently testable.
 */
export function mergeCatalog(seed: RegistryEntry[], overlay: RegistryEntry[]): RegistryEntry[] {
  const byKey = new Map<string, RegistryEntry>();
  for (const entry of seed) byKey.set(`${entry.kind}/${entry.name}`, entry);
  for (const entry of overlay) byKey.set(`${entry.kind}/${entry.name}`, entry);
  return [...byKey.values()];
}

const defaultFs: RegistryFs = {
  readFile: (filePath) => fsp.readFile(filePath, 'utf8'),
  writeFile: async (filePath, data) => {
    await fsp.writeFile(filePath, data, 'utf8');
  },
  mkdir: async (dirPath) => {
    await fsp.mkdir(dirPath, { recursive: true });
  },
};

export const defaultPinnedHttpFetch: HttpFetch = (rawUrl, init) =>
  new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const address = init.resolvedAddress;
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: 'GET',
        signal: init.signal,
        headers: init.headers,
        // Pin the connection to the address validated immediately above. TLS
        // still authenticates the original URL hostname via SNI/Host.
        ...(address === undefined
          ? {}
          : {
              lookup: (_hostname, _options, callback) =>
                typeof _options === 'object' && _options.all
                  ? (
                      callback as unknown as (
                        error: null,
                        addresses: Array<{ address: string; family: 4 | 6 }>,
                      ) => void
                    )(null, [{ address, family: net.isIP(address) as 4 | 6 }])
                  : callback(null, address, net.isIP(address) as 4 | 6),
            }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let consumed = false;
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          headers: {
            get: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : (value ?? null);
            },
          },
          body: res,
          text: () =>
            new Promise<string>((resolveText, rejectText) => {
              if (consumed) return rejectText(new Error('response body already consumed'));
              consumed = true;
              res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
              res.on('end', () => resolveText(Buffer.concat(chunks).toString('utf8')));
              res.on('error', rejectText);
            }),
          discard: () => {
            consumed = true;
            res.resume();
          },
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
export const defaultHostResolver: HostResolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
};

export const REGISTRY_MAX_REDIRECTS = 5;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class RegistryClient {
  private readonly registryUrl: string;
  private readonly cacheDir: string;
  private readonly fetchFn: HttpFetch;
  private readonly resolveHost: HostResolver;
  private readonly fs: RegistryFs;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly maxIndexBytes: number;
  private readonly maxFileBytes: number;
  private readonly allowInsecureLocalhost: boolean;

  constructor(options: RegistryClientOptions = {}) {
    this.registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
    this.cacheDir = options.cacheDir ?? resolveRegistryCacheDir(process.env, os.homedir());
    this.fetchFn = options.fetch ?? defaultPinnedHttpFetch;
    this.resolveHost = options.resolveHost ?? defaultHostResolver;
    this.fs = options.fs ?? defaultFs;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxIndexBytes = options.maxIndexBytes ?? DEFAULT_MAX_INDEX_BYTES;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.allowInsecureLocalhost = options.allowInsecureLocalhost ?? false;
  }

  private get cacheFile(): string {
    return path.join(this.cacheDir, 'index.json');
  }

  private payloadFile(sha256: string): string {
    return path.join(this.cacheDir, 'payloads', sha256);
  }

  /** Effective catalog: seed merged with the resolved overlay (see module doc). */
  async loadCatalog(): Promise<CatalogResult> {
    const seed = loadSeedIndex().entries;
    const overlay = await this.loadOverlay();
    const overlayEntries = overlay.index ? overlay.index.entries : [];
    return { entries: mergeCatalog(seed, overlayEntries), overlaySource: overlay.source };
  }

  /** Convenience: just the merged, validated catalog entries. */
  async getCatalog(): Promise<RegistryEntry[]> {
    return (await this.loadCatalog()).entries;
  }

  /**
   * Resolve every file of an entry to verified bytes. Content-bearing files are
   * re-verified against their sha256; url-bearing files are fetched over HTTPS
   * (or served from the content-addressed cache) and verified. Any mismatch or
   * fetch failure throws — a rejected payload must never be installed.
   */
  async fetchEntryFiles(entry: RegistryEntry): Promise<ResolvedFile[]> {
    const resolved: ResolvedFile[] = [];
    for (const file of entry.files) {
      resolved.push({ path: file.path, content: await this.resolveFile(file) });
    }
    return resolved;
  }

  private async resolveFile(file: RegistryFile): Promise<string> {
    if (typeof file.content === 'string') {
      if (sha256Hex(file.content) !== file.sha256) {
        throw new RegistryVerificationError(`inlined content checksum mismatch for ${file.path}`);
      }
      return file.content;
    }
    if (typeof file.url !== 'string') {
      throw new RegistryVerificationError(`file ${file.path} has no payload`);
    }

    const cached = await this.readPayloadCache(file.sha256);
    if (cached !== null) return cached;

    const body = await this.httpGet(file.url, this.maxFileBytes);
    const actual = sha256Hex(body);
    if (actual !== file.sha256) {
      throw new RegistryVerificationError(
        `payload checksum mismatch for ${file.path}: expected ${file.sha256} got ${actual}`,
      );
    }
    await this.writePayloadCache(file.sha256, body);
    return body;
  }

  /** Resolution order: fresh cache → fetch → stale cache → seed-only (none). */
  private async loadOverlay(): Promise<{ source: OverlaySource; index: RegistryIndex | null }> {
    const cached = await this.readCache();
    if (cached && this.isFresh(cached.fetchedAt)) {
      return { source: 'cache', index: cached.index };
    }
    const fetched = await this.tryFetchIndex();
    if (fetched) {
      await this.writeCache(fetched);
      return { source: 'fetch', index: fetched };
    }
    if (cached) return { source: 'cache', index: cached.index };
    return { source: 'none', index: null };
  }

  private isFresh(fetchedAt: number): boolean {
    const age = this.now() - fetchedAt;
    return age >= 0 && age < this.ttlMs;
  }

  /** Fetch + validate the external index; any failure degrades to null. */
  private async tryFetchIndex(): Promise<RegistryIndex | null> {
    try {
      const body = await this.httpGet(this.registryUrl, this.maxIndexBytes);
      return this.validateIndex(JSON.parse(body));
    } catch {
      return null;
    }
  }

  /**
   * Run untrusted JSON through the trust boundary: strict shape validation
   * (parseRegistryIndex) then drop any entry whose inlined content fails its
   * checksum (verifyEntry). url-bearing entries are kept (verified at fetch).
   */
  private validateIndex(json: unknown): RegistryIndex {
    const { index } = parseRegistryIndex(json);
    const entries = index.entries.filter((entry) => verifyEntry(entry).ok);
    return { version: index.version, entries };
  }

  private async readCache(): Promise<{ fetchedAt: number; index: RegistryIndex } | null> {
    let raw: string;
    try {
      raw = await this.fs.readFile(this.cacheFile);
    } catch {
      return null; // no cache yet / unreadable
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object') return null;
      const fetchedAt = (parsed as { fetchedAt?: unknown }).fetchedAt;
      if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;
      const index = this.validateIndex((parsed as { index?: unknown }).index);
      return { fetchedAt, index };
    } catch {
      return null; // corrupt JSON or a top-level shape parseRegistryIndex rejects
    }
  }

  private async writeCache(index: RegistryIndex): Promise<void> {
    try {
      await this.fs.mkdir(path.dirname(this.cacheFile));
      const payload = JSON.stringify({ version: CACHE_VERSION, fetchedAt: this.now(), index });
      await this.fs.writeFile(this.cacheFile, payload);
    } catch {
      // A read-only/failed cache write is non-fatal — the overlay is still usable.
    }
  }

  private async readPayloadCache(sha256: string): Promise<string | null> {
    if (!SHA256_HEX.test(sha256)) return null;
    try {
      const body = await this.fs.readFile(this.payloadFile(sha256));
      // The cache file is untrusted: only trust it if it still hashes to its key.
      return sha256Hex(body) === sha256 ? body : null;
    } catch {
      return null;
    }
  }

  private async writePayloadCache(sha256: string, body: string): Promise<void> {
    if (!SHA256_HEX.test(sha256)) return;
    try {
      await this.fs.mkdir(path.join(this.cacheDir, 'payloads'));
      await this.fs.writeFile(this.payloadFile(sha256), body);
    } catch {
      // Non-fatal — a failed payload cache write just means we re-fetch next time.
    }
  }

  /** HTTPS GET with DNS guard, manually validated redirects, timeout, and byte cap. */
  private async httpGet(url: string, maxBytes: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let currentUrl = url;
      for (let redirects = 0; ; redirects += 1) {
        const { url: parsed, address } = await this.assertResolvedTarget(
          currentUrl,
          controller.signal,
        );
        const res = await this.fetchFn(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          resolvedAddress: address,
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (location !== null) {
          if (redirects >= REGISTRY_MAX_REDIRECTS) {
            res.discard?.();
            throw new RegistryFetchError(`too many redirects for ${url}`);
          }
          res.discard?.();
          currentUrl = new URL(location, parsed).toString();
          continue;
        }
        if (!res.ok) throw new RegistryFetchError(`HTTP ${res.status} for ${currentUrl}`);
        return await readCapped(res, maxBytes, currentUrl);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertResolvedTarget(
    rawUrl: string,
    signal: AbortSignal,
  ): Promise<{ url: URL; address: string | undefined }> {
    assertFetchableUrl(rawUrl, this.allowInsecureLocalhost);
    const url = new URL(rawUrl);
    if (url.protocol === 'http:' && this.allowInsecureLocalhost && isLocalhost(url.hostname)) {
      return { url, address: undefined };
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname) !== 0) return { url, address: hostname };
    let addresses: readonly string[];
    try {
      addresses = await abortable(this.resolveHost(hostname), signal);
    } catch {
      if (signal.aborted) throw new RegistryFetchError(`request timed out for ${rawUrl}`);
      throw new RegistryFetchError(`unable to resolve registry host: ${hostname}`);
    }
    if (
      addresses.length === 0 ||
      addresses.some((address) => net.isIP(address) === 0 || isBlockedRegistryHost(address))
    ) {
      throw new RegistryFetchError(`refusing private or local address for ${hostname}`);
    }
    return { url, address: addresses[0] };
  }
}

/** Read a response body, rejecting anything larger than `maxBytes`. */
async function readCapped(res: HttpResponse, maxBytes: number, url: string): Promise<string> {
  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new RegistryFetchError(`response for ${url} exceeds ${maxBytes} bytes`);
    }
  }
  if (res.body !== undefined) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        res.discard?.();
        throw new RegistryFetchError(`response for ${url} exceeds ${maxBytes} bytes`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  }
  // Compatibility fallback for injected test transports. The built-in
  // transport always supplies `body`, and therefore never fully buffers first.
  const body = await res.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw new RegistryFetchError(`response for ${url} exceeds ${maxBytes} bytes`);
  }
  return body;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
