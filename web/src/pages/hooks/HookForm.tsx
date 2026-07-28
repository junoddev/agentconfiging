import { Button } from '../../components/core/index.js';
import { findHookEvent, HOOK_EVENTS } from './events.js';
import {
  HOOK_TEMPLATES,
  isDraftValid,
  type HookDraft,
  type HookTargetOption,
  type HookTemplate,
} from './logic.js';

export interface HookFormProps {
  draft: HookDraft;
  onChange: (draft: HookDraft) => void;
  /** Apply a quick-add template's starter values into the draft. */
  onTemplate: (template: HookTemplate) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Writable settings files the hook can be created in (radio choice) — the
   *  project files plus, when usable, the GLOBAL ~/.claude one (bead 71h.10). */
  targets: readonly HookTargetOption[];
  target: string;
  onTargetChange: (path: string) => void;
  /** True while a preview/commit is in flight — disables the controls. */
  busy?: boolean;
}

/**
 * Visual create form (SPEC §5 row 3): pick an event, an optional matcher (only
 * for matcher-scoped events), a type and command — or seed the fields from one of
 * the four quick-add templates. Nothing here writes; submitting hands the draft
 * up to the page, which builds the settings.json content and drives useWriteFlow.
 */
export function HookForm({
  draft,
  onChange,
  onTemplate,
  onSubmit,
  onCancel,
  targets,
  target,
  onTargetChange,
  busy,
}: HookFormProps) {
  const matcherApplies = findHookEvent(draft.event)?.matcherApplies ?? true;
  const valid = isDraftValid(draft);

  return (
    <div className="hook-form surface" role="group" aria-label="create hook">
      <div className="hook-form__templates">
        <span className="micro-label">quick add</span>
        {HOOK_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="hook-form__template"
            title={t.hint}
            disabled={busy}
            onClick={() => onTemplate(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="hook-form__field">
        <span className="micro-label">event</span>
        <select
          className="hook-form__control mono-data"
          value={draft.event}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, event: e.target.value })}
        >
          {HOOK_EVENTS.map((ev) => (
            <option key={ev.name} value={ev.name}>
              {ev.name}
            </option>
          ))}
        </select>
      </label>

      {matcherApplies && (
        <label className="hook-form__field">
          <span className="micro-label">matcher (blank = all)</span>
          <input
            className="hook-form__control mono-data"
            type="text"
            value={draft.matcher}
            placeholder="Bash | Edit|Write"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, matcher: e.target.value })}
          />
        </label>
      )}

      <label className="hook-form__field">
        <span className="micro-label">type</span>
        <input
          className="hook-form__control mono-data"
          type="text"
          value={draft.type}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, type: e.target.value })}
        />
      </label>

      <label className="hook-form__field">
        <span className="micro-label">command</span>
        <textarea
          className="hook-form__control hook-form__textarea mono-data"
          rows={2}
          value={draft.command}
          placeholder=".claude/hooks/my-hook.sh"
          disabled={busy}
          onChange={(e) => onChange({ ...draft, command: e.target.value })}
        />
      </label>

      {targets.length > 1 && (
        <fieldset className="hook-form__field hook-form__targets">
          <legend className="micro-label">write to</legend>
          {targets.map((t) => (
            <label key={t.path} className="hook-form__radio mono-data">
              <input
                type="radio"
                name="hook-target"
                value={t.path}
                checked={t.path === target}
                disabled={busy}
                onChange={() => onTargetChange(t.path)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="hook-form__actions">
        <Button label="preview" variant="primary" onClick={onSubmit} disabled={!valid || busy} />
        <Button label="cancel" onClick={onCancel} disabled={busy} />
      </div>
    </div>
  );
}
