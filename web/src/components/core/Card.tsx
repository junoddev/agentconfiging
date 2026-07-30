import type { ReactNode } from 'react';
import './components.css';

export interface CardProps {
  /** Optional card head (h2, 15px/600). */
  title?: ReactNode;
  children: ReactNode;
}

/** Card (DESIGN.md §5 `.card`): surface + hairline, radius-lg, 18/20px
 *  padding. No shadow at rest — hairlines do the separation work. */
export function Card({ title, children }: CardProps) {
  return (
    <div className="card">
      {title !== undefined && <h2>{title}</h2>}
      {children}
    </div>
  );
}
