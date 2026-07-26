/**
 * Typed API client for the local control center. Every request carries the
 * session token as `Authorization: Bearer <token>` (SPEC §4.3) — the only
 * accepted channel (no `?token=` fallback). Responses are typed against the
 * mirrored wire shapes in ./types.
 *
 * ERROR MODEL: failures surface as `ApiError` with a coarse `kind` so the shell
 * can render an honest state instead of crashing. A 401 (missing/stale token) is
 * `kind: 'unauthorized'` — the shell shows a re-launch prompt rather than a
 * blank page.
 */

import type { FileContent, HealthResponse, InstancesResponse, Report } from './types.js';

export type ApiErrorKind =
  | 'unauthorized' // 401 — token missing or wrong
  | 'forbidden' // 403 — Host/Origin gate
  | 'notfound' // 404 — unknown instance / absent file
  | 'network' // fetch itself threw (server down, offline)
  | 'server' // 5xx
  | 'unknown';

/** A typed API failure. `status` is 0 when the network layer threw. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status >= 500) return 'server';
  return 'unknown';
}

export interface ApiClientOptions {
  /** Base URL prefix; '' (default) targets the same origin the shell loaded from. */
  baseUrl?: string;
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(token: string, opts: ApiClientOptions = {}) {
    this.#token = token;
    this.#baseUrl = opts.baseUrl ?? '';
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  /** GET the report for an instance (or the default instance when omitted). */
  getReport(instance?: string): Promise<Report> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<Report>(`/api/report${qs}`);
  }

  /** GET the hosted instance list. */
  async getInstances(): Promise<InstancesResponse['instances']> {
    const body = await this.#get<InstancesResponse>('/api/instances');
    return body.instances;
  }

  /** GET a health probe (also token-gated). */
  getHealth(): Promise<HealthResponse> {
    return this.#get<HealthResponse>('/api/health');
  }

  /** GET a single in-scope config file's RAW content (render as text only). */
  getFile(path: string): Promise<FileContent> {
    return this.#get<FileContent>(`/api/file?path=${encodeURIComponent(path)}`);
  }

  async #get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.#token}` },
      });
    } catch (err) {
      throw new ApiError(0, 'network', `request failed: ${String(err)}`);
    }
    if (!res.ok) {
      throw new ApiError(res.status, kindForStatus(res.status), `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
