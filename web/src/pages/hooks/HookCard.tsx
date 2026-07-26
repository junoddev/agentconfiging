import { useState } from 'react';
import { Button } from '../../components/core/index.js';
import type { HookEntry } from './logic.js';

export interface HookCardProps {
  entry: HookEntry;
  /** The settings file this hook lives in (label + write target). */
  source: string;
  /** Remove handler; omitted (or read-only) hides the [REMOVE] control. */
  onRemove?: () => void;
  /** When true the card is display-only (e.g. the file is redacted). */
  readOnly?: boolean;
}

/**
 * A single hook as a collapsible card (SPEC §5 row 3): summary shows the event +
 * matcher; the body shows type / command / timeout / source. Every value comes
 * from adversarially parsed config and is rendered as a TEXT NODE only — never
 * markup, and the command is surfaced, never executed.
 */
export function HookCard({ entry, source, onRemove, readOnly }: HookCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="hook-card surface">
      <button
        type="button"
        className="hook-card__summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hook-card__caret mono-data" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
        <span className="hook-card__event mono-data">{entry.event}</span>
        <span className="hook-card__matcher micro-label">
          {entry.matcher !== undefined && entry.matcher !== ''
            ? `matcher · ${entry.matcher}`
            : 'all'}
        </span>
      </button>

      {open && (
        <dl className="hook-card__body">
          <div className="hook-card__row">
            <dt className="micro-label">type</dt>
            <dd className="mono-data">{entry.type ?? '—'}</dd>
          </div>
          <div className="hook-card__row">
            <dt className="micro-label">command</dt>
            <dd className="mono-data hook-card__command">{entry.command ?? '—'}</dd>
          </div>
          {entry.timeout !== undefined && (
            <div className="hook-card__row">
              <dt className="micro-label">timeout</dt>
              <dd className="mono-data">{entry.timeout}s</dd>
            </div>
          )}
          <div className="hook-card__row">
            <dt className="micro-label">source</dt>
            <dd className="mono-data">{source}</dd>
          </div>
          {onRemove && !readOnly && (
            <div className="hook-card__actions">
              <Button label="remove" variant="destructive" onClick={onRemove} />
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
