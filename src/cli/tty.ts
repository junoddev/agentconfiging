/**
 * Render-mode + color policy (DESIGN §8): one theme, respect NO_COLOR and
 * non-TTY. When stdout is piped there is no Ink layout at all — plain
 * timestamped lines only. Pure functions; callers inject env/isTTY.
 */

export type RenderMode = 'ink' | 'plain';

/** Ink layout only on a real TTY; piped output degrades to plain lines. */
export function resolveRenderMode(isTTY: boolean): RenderMode {
  return isTTY ? 'ink' : 'plain';
}

/**
 * Color only on a TTY and only when NO_COLOR is absent or empty
 * (https://no-color.org: any non-empty value disables color).
 */
export function colorEnabled(env: Record<string, string | undefined>, isTTY: boolean): boolean {
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return false;
  return isTTY;
}
