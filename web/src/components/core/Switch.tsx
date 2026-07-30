import './components.css';

export interface SwitchProps {
  /** Current state; on = accent track, surface knob. */
  on: boolean;
  /** Called with the next state on toggle. */
  onChange: (next: boolean) => void;
  /** Accessible name — the switch has no visible label of its own. */
  label: string;
  disabled?: boolean;
}

/** Toggle switch (DESIGN.md §5 `.switch`): 34×19px track, 13px knob,
 *  0.15s ease. A real `role="switch"` button. */
export function Switch({ on, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'switch on' : 'switch'}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}
