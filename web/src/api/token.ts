/**
 * Token bootstrap (SPEC §4.3). The server embeds a per-session bearer token in
 * the launch URL as a FRAGMENT: `http://127.0.0.1:<port>/#token=<token>`. The
 * fragment never reaches the server, proxies, or logs. On boot the UI reads
 * `location.hash`, keeps the token in memory, and strips it from the address bar
 * via `history.replaceState` so it does not linger in a shared/bookmarked URL.
 * Thereafter it travels only as `Authorization: Bearer <token>` (HTTP) or the
 * WS subprotocol — never in a query string.
 *
 * The hash may also carry the app route (`#/gallery`). We extract ONLY the
 * `token=` segment and preserve the rest as the route hash.
 */

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
 * Read the token from the current location, strip it from the address bar, and
 * return it (or undefined when absent). Idempotent-safe: after the strip a
 * second call sees no token. `loc`/`hist` are injectable for tests.
 */
export function bootstrapToken(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState'> = window.history,
): string | undefined {
  const { token, rest } = parseTokenHash(loc.hash);
  if (token === undefined) return undefined;
  // Rewrite the URL without the token fragment, preserving path + query + any
  // surviving route hash. replaceState does not trigger a navigation.
  hist.replaceState(null, '', `${loc.pathname}${loc.search}${rest}`);
  return token;
}
