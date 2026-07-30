import type { ReactNode } from 'react';
import './components.css';

export interface ListCardProps {
  /** Optional mono uppercase group header (`.lc-head`), e.g. "USER SCOPE". */
  head?: ReactNode;
  /** Right-aligned meta in the head, e.g. "3 items". */
  headMeta?: ReactNode;
  /** `ListRow`s (or compatible row markup). */
  children: ReactNode;
}

/** List card (DESIGN.md §5 `.list-card`): radius-lg hairline card with an
 *  optional fg-soft group header and hairline-separated rows. */
export function ListCard({ head, headMeta, children }: ListCardProps) {
  return (
    <div className="list-card">
      {head !== undefined && (
        <div className="lc-head">
          <span>{head}</span>
          {headMeta !== undefined && <span>{headMeta}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export interface ListRowProps {
  /** Leading control, usually a `Switch`. */
  leading?: ReactNode;
  /** Row title (sans 550). */
  title: ReactNode;
  /** Inline badge beside the title, usually a `SourceBadge`. */
  badge?: ReactNode;
  /** Muted 12.5px sub-line, ellipsized to one line. */
  sub?: ReactNode;
  /** Trailing meta + ghost action(s). */
  trailing?: ReactNode;
}

/** List row (DESIGN.md §5 `.list-row`): leading control · title + inline
 *  badge · ellipsized sub-line · trailing meta/action. Hover = fg-soft. */
export function ListRow({ leading, title, badge, sub, trailing }: ListRowProps) {
  return (
    <div className="list-row">
      {leading}
      <div className="lr-main">
        <div className="lr-title">
          {title}
          {badge}
        </div>
        {sub !== undefined && <div className="lr-sub">{sub}</div>}
      </div>
      {trailing}
    </div>
  );
}
