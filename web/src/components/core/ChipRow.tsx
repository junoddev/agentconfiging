import './components.css';

export interface ChipOption {
  value: string;
  /** Visible label, e.g. value "all" → "All scopes". */
  label: string;
}

interface ChipRowBaseProps {
  options: readonly ChipOption[];
  /** Accessible name for the filter group, e.g. "Scope filter". */
  label: string;
}

/** Single-select: exactly one chip is active (e.g. a scope filter). */
export interface ChipRowSingleProps extends ChipRowBaseProps {
  /** Selected option value. */
  value: string;
  onChange: (value: string) => void;
}

/** Multi-select: any subset of chips is active (e.g. the catalog kind filter). */
export interface ChipRowMultiProps extends ChipRowBaseProps {
  /** Selected option values. */
  values: readonly string[];
  /** Flip one value in/out of the selection. */
  onToggle: (value: string) => void;
}

export type ChipRowProps = ChipRowSingleProps | ChipRowMultiProps;

/** Filter chips (DESIGN.md §5 `.chip-row`/`.chip`): recessed fg-soft track;
 *  active chips lift to surface with a subtle shadow. Single-select
 *  (`value`/`onChange`) or multi-select (`values`/`onToggle`). */
export function ChipRow(props: ChipRowProps) {
  const { options, label } = props;
  const isActive = (value: string) =>
    'values' in props ? props.values.includes(value) : props.value === value;
  const pick = (value: string) => {
    if ('values' in props) props.onToggle(value);
    else props.onChange(value);
  };
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={isActive(option.value) ? 'chip active' : 'chip'}
          aria-pressed={isActive(option.value)}
          onClick={() => pick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
