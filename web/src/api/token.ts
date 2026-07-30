/**
 * Token bootstrap (SPEC §4.3). The server embeds a per-session bearer token in
 * the launch URL as a FRAGMENT: `http://127.0.0.1:<port>/#token=<token>`. The
 * fragment never reaches the server, proxies, or logs. On boot the UI reads
 * `location.hash`, strips it from the address bar via `history.replaceState` so
 * it does not linger in a shared/bookmarked URL, and persists it to
 * `sessionStorage` so a page refresh — which reloads WITHOUT the fragment — can
 * recover it instead of dead-ending on "session token missing". Thereafter it
 * travels only as `Authorization: Bearer <token>` (HTTP) or the WS subprotocol —
 * never in a query string.
 *
 * `sessionStorage` is origin-scoped, cleared when the tab closes, and never sent
 * to the server — strictly less leak-prone than the `?token=` query channel the
 * server rejects. It is a deliberate relaxation of the earlier memory-only rule,
 * traded for refresh survival on this loopback-only, single-user tool.
 *
 * The hash may also carry the app route (`#/gallery`). We extract ONLY the
 * `token=` segment and preserve the rest as the route hash.
 */

/** sessionStorage key the launch token is persisted under for refresh survival. */
const TOKEN_STORAGE_KEY = 'agentconfig:session-token';

export interface ParsedToken {
  /** The extracted token, if a `token=` segment was present. */
  token?: string;
  /** The hash with the token segment removed, e.g. '' or '#/gallery'. */
  rest: string;
}

/**
 * Pure parse of a `location.hash` string. Splits on `&`, pulls out the first
 * `token=` segment, and rejoins the remainder as the surviving hash. Returns the
 * surviving hash WITH its leading `#` (or '' when nothing survives) so it can be
 * written straight back to the address bar.
 */
export function parseTokenHash(hash: string): ParsedToken {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return { rest: '' };
  const segments = raw.split('&');
  let token: string | undefined;
  const kept: string[] = [];
  for (const segment of segments) {
    if (token === undefined && segment.startsWith('token=')) {
      const value = segment.slice('token='.length);
      // An empty `token=` carries no token; treat it as absent.
      if (value !== '') token = decodeURIComponent(value);
      continue;
    }
    kept.push(segment);
  }
  const restBody = kept.join('&');
  const result: ParsedToken = { rest: restBody === '' ? '' : `#${restBody}` };
  if (token !== undefined) result.token = token;
  return result;
}

/**
 * Resolve the session token for this tab. On a fresh launch the token arrives in
 * the URL fragment: we persist it to `sessionStorage`, strip it from the address
 * bar, and return it. On a refresh the fragment is gone, so we fall back to the
 * persisted copy. Returns undefined only when neither channel has a token.
 *
 * Idempotent: repeated calls after the first strip read from storage and never
 * touch history again. `loc`/`hist`/`store` are injectable for tests.
 */
export function bootstrapToken(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState'> = window.history,
  store: Pick<Storage, 'getItem' | 'setItem'> | undefined = defaultSessionStore(),
): string | undefined {
  const { token, rest } = parseTokenHash(loc.hash);
  if (token !== undefined) {
    // Persist first so a refresh can recover the token, then rewrite the URL
    // without the fragment (preserving path + query + any surviving route hash).
    // replaceState does not trigger a navigation.
    try {
      store?.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // Storage blocked (private mode / sandboxed iframe): token stays in memory
      // for this load; a later refresh will dead-end and require relaunch.
    }
    hist.replaceState(null, '', `${loc.pathname}${loc.search}${rest}`);
    return token;
  }
  // No fragment — typically a refresh. Recover the token persisted on first boot.
  try {
    return store?.getItem(TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Access sessionStorage defensively — property access can throw in sandboxes. */
function defaultSessionStore(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}
