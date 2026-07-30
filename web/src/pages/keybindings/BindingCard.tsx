/**
 * BindingCard — read-only display of one {@link Binding} (bead wmc.9). Every
 * value (combo, command, condition, preserved extras) is adversarial config data
 * rendered as a TEXT NODE only — never markup, never executed. A chorded combo
 * is shown as its ordered steps. Edit/remove controls appear only when the file
 * is writable (the page withholds them for a redacted / parse-error source).
 * The `badge` slot carries the row's scope badge (provenance is never implicit).
 */

import type { ReactNode } from 'react';
import { Button, Pill } from '../../components/core/index.js';
import { chordSteps, isChord, type Binding } from './logic.js';

export interface BindingCardProps {
  binding: Binding;
  /** Scope badge for the card (SourceBadge), per the provenance rule. */
  badge?: ReactNode;
  /** Omit both to render a purely read-only card. */
  onEdit?: () => void;
  onRemove?: () => void;
}

/** Render a combo as ordered chord steps joined by an inert "then" marker. */
function Combo({ keyCombo }: { keyCombo: string }) {
  const steps = chordSteps(keyCombo);
  if (steps.length === 0) return <span className="mono-data">—</span>;
  return (
    <span className="kb-card__combo">
      {steps.map((step, i) => (
        <span key={i} className="kb-card__step-wrap">
          {i > 0 && (
            <span className="meta" aria-hidden="true">
              then
            </span>
          )}
          <span className="code">{step}</span>
        </span>
      ))}
    </span>
  );
}

export function BindingCard({ binding, badge, onEdit, onRemove }: BindingCardProps) {
  const editable = onEdit !== undefined || onRemove !== undefined;
  const extraKeys = Object.keys(binding.extra);
  return (
    <div className="card kb-card">
      <div className="kb-card__head">
        <Combo keyCombo={binding.key} />
        {isChord(binding.key) && <Pill tone="ok">chord</Pill>}
        {badge}
        {editable && (
          <span className="kb-card__actions">
            {onEdit && <Button label="Edit" variant="ghost" onClick={onEdit} />}
            {onRemove && <Button label="Remove" variant="destructive" onClick={onRemove} />}
          </span>
        )}
      </div>

      <div className="kb-card__row">
        <span className="table-header">command</span>
        <span className="mono-data kb-card__val">{binding.command || '—'}</span>
      </div>

      {binding.condition !== undefined && (
        <div className="kb-card__row">
          <span className="table-header">{binding.conditionKey ?? 'condition'}</span>
          <span className="mono-data kb-card__val">{binding.condition}</span>
        </div>
      )}

      {extraKeys.length > 0 && (
        <div className="kb-card__row">
          <span className="table-header">preserved</span>
          <span className="mono-data kb-card__val muted">{extraKeys.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
