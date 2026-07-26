/** Reduced-motion resolution (docs/DESIGN.md §5).
 *  Pure logic here; the React hook is a thin subscription over it. Components
 *  accept a `reducedMotion` prop override so both modes are testable. */

import { useSyncExternalStore } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Minimal shape of `window.matchMedia` needed here — injectable for tests. */
export type MatchMediaLike = (query: string) => { matches: boolean };

/** Read the system preference via an injectable matchMedia. Environments
 *  without matchMedia (node, old jsdom) resolve to false (motion allowed). */
export function systemPrefersReducedMotion(
  matchMediaFn: MatchMediaLike | undefined = typeof matchMedia === 'function'
    ? matchMedia
    : undefined,
): boolean {
  if (!matchMediaFn) return false;
  return matchMediaFn(REDUCED_MOTION_QUERY).matches;
}

/** Prop override wins over the system preference; undefined defers to it. */
export function resolveReducedMotion(override: boolean | undefined, system: boolean): boolean {
  return override ?? system;
}

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mql = matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Live reduced-motion state for components. `override` (when defined) pins
 *  the result regardless of the media query. */
export function useReducedMotion(override?: boolean): boolean {
  const system = useSyncExternalStore(
    subscribe,
    () => systemPrefersReducedMotion(),
    () => false,
  );
  return resolveReducedMotion(override, system);
}
