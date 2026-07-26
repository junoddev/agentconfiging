import './components.css';

export interface EmptyStateProps {
  /** Headline in the giant-numeral style. §7 voice — defaults to NO SIGNAL. */
  title?: string;
  /** One-line imperative instruction, e.g. "add a folder to begin watching". */
  instruction: string;
}

/** Empty state (DESIGN.md §6): `NO SIGNAL` in giant-numeral style, one-line
 *  instruction, and a static flat-line trace — a dead signal, not a spinner. */
export function EmptyState({ title = 'NO SIGNAL', instruction }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="numeral-giant numeral-giant--sm">{title}</div>
      <p className="micro-label">{instruction}</p>
      <div className="empty__flatline" aria-hidden="true" />
    </div>
  );
}
