import { Button, Field, Input, Select } from '../../components/core/index.js';
import { findHookEvent, HOOK_EVENTS } from './events.js';
import {
  HOOK_TEMPLATES,
  type HookDraft,
  type HookTargetOption,
  type HookTemplate,
} from './logic.js';

export interface HookFormProps {
  draft: HookDraft;
  onChange: (draft: HookDraft) => void;
  /** Apply a quick-add template's starter values into the draft. */
  onTemplate: (template: HookTemplate) => void;
  /** Writable settings files the hook can be created in (select choice) — the
   *  project files plus, when usable, the GLOBAL ~/.claude one (bead 71h.10). */
  targets: readonly HookTargetOption[];
  target: string;
  onTargetChange: (path: string) => void;
  /** True while a preview/commit is in flight — disables the controls. */
  busy?: boolean;
}

/**
 * Create-hook fields (Console conversion, bead 4u1.4): shared `.field`/`.input`
 * controls rendered inside the shared Dialog — the dialog's footer owns the
 * Preview/Cancel verbs. Pick an event, an optional matcher (only for
 * matcher-scoped events), a type and command — or seed the fields from one of
 * the quick-add templates. Nothing here writes; the page builds the
 * settings.json content and drives useWriteFlow.
 */
export function HookForm({
  draft,
  onChange,
  onTemplate,
  targets,
  target,
  onTargetChange,
  busy,
}: HookFormProps) {
  const matcherApplies = findHookEvent(draft.event)?.matcherApplies ?? true;

  return (
    <div role="group" aria-label="create hook">
      <div className="hook-form-templates">
        <span className="meta">Quick add</span>
        {HOOK_TEMPLATES.map((t) => (
          <Button
            key={t.id}
            label={t.label}
            variant="secondary"
            disabled={busy}
            onClick={() => onTemplate(t)}
          />
        ))}
      </div>

      <Field label="Event" htmlFor="hook-event">
        <Select
          id="hook-event"
          className="mono"
          value={draft.event}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, event: e.target.value })}
        >
          {HOOK_EVENTS.map((ev) => (
            <option key={ev.name} value={ev.name}>
              {ev.name}
            </option>
          ))}
        </Select>
      </Field>

      {matcherApplies && (
        <Field label="Matcher (blank = all)" htmlFor="hook-matcher">
          <Input
            id="hook-matcher"
            className="mono"
            type="text"
            value={draft.matcher}
            placeholder="Bash | Edit|Write"
            disabled={busy}
            onChange={(e) => onChange({ ...draft, matcher: e.target.value })}
          />
        </Field>
      )}

      <Field label="Type" htmlFor="hook-type">
        <Input
          id="hook-type"
          className="mono"
          type="text"
          value={draft.type}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, type: e.target.value })}
        />
      </Field>

      <Field label="Command" htmlFor="hook-command">
        <textarea
          id="hook-command"
          className="input mono"
          rows={2}
          value={draft.command}
          placeholder=".claude/hooks/my-hook.sh"
          disabled={busy}
          onChange={(e) => onChange({ ...draft, command: e.target.value })}
        />
      </Field>

      {targets.length > 1 && (
        <Field label="Write to" htmlFor="hook-target">
          <Select
            id="hook-target"
            className="mono"
            value={target}
            disabled={busy}
            onChange={(e) => onTargetChange(e.target.value)}
          >
            {targets.map((t) => (
              <option key={t.path} value={t.path}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
