/** Index-formatting helper (used by the command palette). DOM-free.
 *  The FindingRow/severity survivors retired with the E13 page waves. */

/** 2-digit timetable index: 1 → "01", 12 → "12". 1-based; three digits pass
 *  through untouched (100 → "100"). */
export function formatIndex(index: number): string {
  return String(index).padStart(2, '0');
}
