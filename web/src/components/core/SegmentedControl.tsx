import './components.css';

export interface SegmentedControlProps {
  /** Enum values, rendered verbatim in mono (name things what the tool
   *  names them: "acceptEdits", "workspace-write", …). */
  options: readonly string[];
  /** Currently selected value. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group, e.g. "Approval policy". */
  label: string;
}

/** Segmented options (DESIGN.md §5 `.seg`): mono outlined buttons; the
 *  selection wears accent border/text/soft-bg. For enum settings. */
export function SegmentedControl({ options, value, onChange, label }: SegmentedControlProps) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === value ? 'active' : undefined}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
