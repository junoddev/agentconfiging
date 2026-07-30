import './components.css';

export interface EmptyStateProps {
  /** Optional short headline, e.g. "No hooks yet". */
  title?: string;
  /** §7 voice: name the filter/cause that produced the empty state,
   *  e.g. 'No settings match "verbose"' or "This project has no hooks". */
  instruction: string;
}

/** Empty / no-match state (DESIGN.md §7): plain muted copy that names what
 *  caused it — no flatline theatrics, no invented metrics. */
export function EmptyState({ title, instruction }: EmptyStateProps) {
  return (
    <div className="empty">
      {title !== undefined && <div className="empty__title">{title}</div>}
      <p>{instruction}</p>
    </div>
  );
}
