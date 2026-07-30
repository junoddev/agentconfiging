import type { ReactNode } from 'react';
import './components.css';

/** A column head: a plain label, or `{ label, className }` when the `<th>`
 *  needs a class (e.g. `num-col` to right-align a numeric column). */
export type TableHeader = string | { label: string; className?: string };

export interface TableProps {
  /** Column heads (mono uppercase 11px). Omit for headless tables. */
  headers?: readonly TableHeader[];
  /** Row content: `<tr>` elements. Use `className="mono"` on tds carrying
   *  paths/keys/values and `className="num-col"` for right-aligned numerics. */
  children: ReactNode;
}

/** Console data table (DESIGN.md §5): `.ds-table` wrapped in a radius-lg
 *  `.table-card` — bottom hairlines only, row hover `--fg-soft`, no striping,
 *  no vertical rules. */
export function Table({ headers, children }: TableProps) {
  return (
    <div className="table-card">
      <table className="ds-table">
        {headers && (
          <thead>
            <tr>
              {headers.map((header) => {
                const { label, className } =
                  typeof header === 'string' ? { label: header, className: undefined } : header;
                return (
                  <th key={label} scope="col" className={className}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
