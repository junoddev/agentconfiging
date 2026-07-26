/** Pure display helpers for the web UI. */

/** "1 finding" / "3 findings" — used in status lines and badges. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
