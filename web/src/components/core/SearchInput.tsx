import './components.css';

export interface SearchInputProps {
  value: string;
  /** Called with the raw input value on every change. */
  onChange: (value: string) => void;
  /** e.g. 'Filter settings…' — also the accessible name unless `label` is set. */
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
}

/** Search input (DESIGN.md §5 `.search`): surface + hairline, 230px; focus =
 *  accent border + 2px accent-soft ring (the shared input focus treatment). */
export function SearchInput({ value, onChange, placeholder, label }: SearchInputProps) {
  return (
    <input
      type="text"
      className="search"
      value={value}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
