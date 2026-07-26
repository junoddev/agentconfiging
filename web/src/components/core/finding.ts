/** FindingRow pure logic (docs/DESIGN.md §6). DOM-free. */

export type Severity = 'ok' | 'warn' | 'error';

/** Severity → color token. Severity is the only place color appears in text
 *  (§2), and these three tokens are the entire severity palette. */
export function severityToken(severity: Severity): '--signal' | '--warn' | '--red' {
  switch (severity) {
    case 'ok':
      return '--signal';
    case 'warn':
      return '--warn';
    case 'error':
      return '--red';
  }
}

/** Severity → modifier class for the 8px severity block. */
export function severityClass(severity: Severity): `sev--${Severity}` {
  return `sev--${severity}`;
}

/** 2-digit timetable index: 1 → "01", 12 → "12". 1-based; three digits pass
 *  through untouched (100 → "100"). */
export function formatIndex(index: number): string {
  return String(index).padStart(2, '0');
}
