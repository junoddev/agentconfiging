/**
 * BindingForm — the visual add/edit form for one {@link Binding} (bead wmc.9). It
 * builds a Binding from plain inputs and hands it to `onPreview`, which drives
 * the dry-run diff through useWriteFlow. It performs NO write itself.
 *
 * The combo field accepts a whitespace-separated chord ("ctrl+g ctrl+s"); the
 * live step readout shows how it parses. An edited binding's preserved `extra`
 * keys and condition source-key are carried through untouched (build() reattaches
 * them), so unmodeled JSON is never dropped on save.
 */

import { useMemo, useState } from 'react';
import { Button, Field, Input } from '../../components/core/index.js';
import { buildBinding, chordSteps, invalidReason, type Binding } from './logic.js';

export interface BindingFormProps {
  mode: 'add' | 'edit';
  /** The binding being edited (edit mode) — seeds the fields. */
  initial?: Binding;
  onPreview: (binding: Binding) => void;
  onCancel: () => void;
}

interface FormState {
  key: string;
  command: string;
  condition: string;
}

function seed(initial: Binding | undefined): FormState {
  return {
    key: initial?.key ?? '',
    command: initial?.command ?? '',
    condition: initial?.condition ?? '',
  };
}

export function BindingForm({ mode, initial, onPreview, onCancel }: BindingFormProps) {
  const [state, setState] = useState<FormState>(() => seed(initial));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const invalid = useMemo(() => invalidReason(state), [state]);
  const steps = useMemo(() => chordSteps(state.key), [state.key]);

  function preview() {
    onPreview(buildBinding({ ...state, seed: initial }));
  }

  return (
    <div className="card kb-form">
      <div className="table-header kb-form__title">
        {mode === 'add' ? 'add binding' : `edit · ${initial?.key ?? ''}`}
      </div>

      <Field label="Key combo — space-separate steps for a chord" htmlFor="kb-form-key">
        <Input
          id="kb-form-key"
          className="mono"
          value={state.key}
          onChange={(e) => set('key', e.target.value)}
          spellCheck={false}
          placeholder="ctrl+g ctrl+s"
        />
      </Field>

      {steps.length > 1 && (
        <p className="kb-form__steps meta">
          chord · {steps.length} steps · {steps.join(' → ')}
        </p>
      )}

      <Field label="Command" htmlFor="kb-form-command">
        <Input
          id="kb-form-command"
          className="mono"
          value={state.command}
          onChange={(e) => set('command', e.target.value)}
          spellCheck={false}
          placeholder="chat.insertNewline"
        />
      </Field>

      <Field label="Condition — context / when (optional)" htmlFor="kb-form-condition">
        <Input
          id="kb-form-condition"
          className="mono"
          value={state.condition}
          onChange={(e) => set('condition', e.target.value)}
          spellCheck={false}
          placeholder="chat"
        />
      </Field>

      {invalid !== undefined && <p className="kb-form__hint meta">{invalid}</p>}

      <div className="kb-form__actions">
        <Button
          label="Preview change"
          variant="primary"
          disabled={invalid !== undefined}
          onClick={preview}
        />
        <Button label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );
}
