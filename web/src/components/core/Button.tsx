import './components.css';

/** Console §5 button variants. `default` and `destructive` are transitional
 *  aliases kept so pre-Console call sites compile: `default` renders as
 *  secondary, `destructive` as the danger-hued secondary (`.btn-danger`). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'default';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  destructive: 'btn-danger',
  default: 'btn-secondary',
};

export interface ButtonProps {
  /** A verb that says what happens ("Save hook", "Resume"). Rendered as-is —
   *  sans, 550 weight; no brackets, no uppercasing. */
  label: string;
  /** primary = accent fill (accent budget: primary actions only) ·
   *  secondary = surface + hairline · ghost = muted text. */
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
}

/** Console button (DESIGN.md §5 `.btn-*`): 1px translateY press, 45% opacity
 *  when disabled. */
export function Button({ label, variant = 'secondary', onClick, disabled }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn ${VARIANT_CLASS[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
