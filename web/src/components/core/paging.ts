/** Pure Pager math — kept out of the component for unit tests. */

/** Total pages for a result set; at least 1 so "Page 1 / 1" reads sanely. */
export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/** §5 meta line: `Showing 1–20 of 42` (1-based, en-dash), or `0 results`. */
export function pagerSummary(page: number, pageSize: number, total: number): string {
  if (total <= 0) return '0 results';
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return `Showing ${start + 1}–${end} of ${total}`;
}
