/**
 * Shell preferences (E10 qoc.2): theme persistence + first-run onboarding flag.
 *
 * These are NON-SENSITIVE user preferences (a colour scheme, a "seen the intro"
 * boolean), so they live in `localStorage` — durable across tabs and restarts.
 * The session token is different: it lives in `sessionStorage` (tab-scoped,
 * cleared on close) purely so a refresh can recover it, never in `localStorage`
 * and never on the wire as a query string — see api/token.ts. The pure
 * resolve/guard functions below carry the logic that tests pin; the thin
 * read/write wrappers tolerate a disabled store (private mode).
 */

/** Console themes (docs/DESIGN.md §1): dark is the native mode, light the
 *  first-class inverse. `data-theme` on <html> carries one of these. */
export type Theme = 'light' | 'dark';

/** Pre-Console (Signal Grid) stored values migrate: paper→light, ink→dark. */
const LEGACY_THEMES: Record<string, Theme> = { paper: 'light', ink: 'dark' };

export const THEME_KEY = 'agentconfig:theme';
export const ONBOARDED_KEY = 'agentconfig:onboarded';

/** Seed the theme on mount: a valid stored choice wins (legacy paper/ink
 *  values migrate); otherwise the OS preference; otherwise DARK — the tool is
 *  launched from a terminal, dark is its native mode. Pure — the caller passes
 *  the stored value and the `matchMedia` result (null when the OS expresses no
 *  preference), so this is trivially testable. */
export function resolveInitialTheme(
  stored: string | null,
  systemPrefersDark: boolean | null,
): Theme {
  const migrated = stored != null && stored in LEGACY_THEMES ? LEGACY_THEMES[stored] : stored;
  if (migrated === 'light' || migrated === 'dark') return migrated;
  if (systemPrefersDark === false) return 'light';
  return 'dark';
}

/** First-run guard: the onboarding overlay shows until the flag reads 'true'. */
export function shouldShowOnboarding(flag: string | null): boolean {
  return flag !== 'true';
}

/** Version label for the about dialog: the health probe's version, or a dash
 *  before it resolves / when it is unavailable. Pure. */
export function displayVersion(version: string | undefined): string {
  return version && version.trim() !== '' ? version : '—';
}

function storage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    // Storage disabled (private mode / sandbox) — preferences degrade to session-only.
    return undefined;
  }
}

/** Read the stored theme choice, or null when unset / storage unavailable. */
export function readTheme(): string | null {
  try {
    return storage()?.getItem(THEME_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Persist an explicit theme choice so it survives reload. Legacy paper/ink
 *  values (from callers not yet migrated to light/dark) store migrated. */
export function writeTheme(theme: Theme | 'paper' | 'ink'): void {
  try {
    storage()?.setItem(THEME_KEY, LEGACY_THEMES[theme] ?? theme);
  } catch {
    // Storage disabled — the theme still applies for this session.
  }
}

/** Read the onboarding flag, or null when the user has not finished first-run. */
export function readOnboarded(): string | null {
  try {
    return storage()?.getItem(ONBOARDED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Mark first-run complete so the onboarding overlay never reappears. */
export function writeOnboarded(): void {
  try {
    storage()?.setItem(ONBOARDED_KEY, 'true');
  } catch {
    // Storage disabled — the overlay may reappear next session; harmless.
  }
}
