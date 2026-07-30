import { Button } from './Button.js';
import { pageCount, pagerSummary } from './paging.js';
import './components.css';

export interface PagerProps {
  /** Current page, 1-based. */
  page: number;
  pageSize: number;
  /** Total result count (post-filter — the pager names what the search fed it). */
  total: number;
  /** Called with the new 1-based page on Prev/Next. */
  onPage: (page: number) => void;
}

/** Pager (DESIGN.md §5 `.pager`): meta "Showing x–y of n" left; Prev /
 *  `Page x / y` / Next right. Buttons disable at the bounds. */
export function Pager({ page, pageSize, total, onPage }: PagerProps) {
  const pages = pageCount(total, pageSize);
  return (
    <div className="pager">
      <span className="meta">{pagerSummary(page, pageSize, total)}</span>
      <div className="pager-nav">
        <Button label="← Prev" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="meta">
          Page {page} / {pages}
        </span>
        <Button label="Next →" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  );
}
