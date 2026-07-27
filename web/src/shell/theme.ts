/**
 * Shell preferences (E10 qoc.2): theme persistence + first-run onboarding flag.
 *
 * These are NON-SENSITIVE user preferences (a colour scheme, a "seen the intro"
 * boolean), so — like the budget threshold (E7) — they live in `localStorage`.
 * The session token is the opposite: it stays memory-only and NEVER touches
 * storage. The pure resolve/guard functions below carry the logic that tests
 * pin; the thin read/write wrappers tolerate a disabled store (private mode).
 */

import type { Theme } from './TopBar.js';

export const THEME_KEY = 'agentconfig:theme';
export const ONBOARDED_KEY = 'agentconfig:onboarded';

/** Seed the theme on mount: a valid stored choice wins; otherwise fall back to
 *  the OS preference (the pre-persistence behaviour). Pure — the caller passes
 *  the stored value and `matchMedia` result, so this is trivially testable. */
export function resolveInitialTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === 'ink' || stored === 'paper') return stored;
  return systemPrefersDark ? 'ink' : 'paper';
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

/** Persist an explicit theme choice so it survives reload. */
export function writeTheme(theme: Theme): void {
  try {
    storage()?.setItem(THEME_KEY, theme);
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
