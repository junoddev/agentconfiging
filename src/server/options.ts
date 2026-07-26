/**
 * Server binding policy per SPEC §4: loopback only, random port by default.
 * Pure and testable; the actual server (Hono) lands in a later bead.
 */

export const LOOPBACK_HOST = '127.0.0.1';

export interface ServerOptions {
  host: typeof LOOPBACK_HOST;
  /** 0 asks the OS for a random free port. */
  port: number;
}

export function resolveServerOptions(overrides: { port?: number } = {}): ServerOptions {
  const port = overrides.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`invalid port: ${port}`);
  }
  return { host: LOOPBACK_HOST, port };
}
