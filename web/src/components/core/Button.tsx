import './components.css';

export type ButtonVariant = 'default' | 'primary' | 'destructive';

export interface ButtonProps {
  /** Label without brackets; rendered all-caps in brackets: "apply" → [APPLY]. */
  label: string;
  /** default = hairline outline · primary = `--fg` fill · destructive = `--red` fill. */
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
}

/** Bracket button (DESIGN.md §6): rectangular, 2px radius, mono all-caps.
 *  Chassis — never animates. */
export function Button({ label, variant = 'default', onClick, disabled }: ButtonProps) {
  return (
    <button type="button" className={`btn btn--${variant}`} onClick={onClick} disabled={disabled}>
      [{label.toUpperCase()}]
    </button>
  );
}
