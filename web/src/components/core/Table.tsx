import type { ReactNode } from 'react';
import './components.css';

export interface TableProps {
  /** Column heads, rendered as micro-label `<th>`s. Omit for headless tables. */
  headers?: readonly string[];
  /** Row content: `<tr>` elements with plain `<td>`s. */
  children: ReactNode;
}

/** Hairline-ruled table (DESIGN.md §4): 40px rows, no zebra striping, ever.
 *  Light wrapper over the foundation `.table-hairline` styles. */
export function Table({ headers, children }: TableProps) {
  return (
    <table className="table-hairline mono-data">
      {headers && (
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="micro-label">
                {header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>{children}</tbody>
    </table>
  );
}
