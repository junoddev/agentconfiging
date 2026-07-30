import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import './components.css';

export interface FieldProps {
  /** Field label (12px muted), a noun: "Event", "Matcher", "Command". */
  label: ReactNode;
  /** id of the control inside, for label association. */
  htmlFor?: string;
  /** One `.input` control (Input, Select, or compatible). */
  children: ReactNode;
}

/** Form field (DESIGN.md §5 `.field`): muted label over its control, 14px
 *  stack gap. Lives in dialogs and settings panes. */
export function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/** Text input (`.input`): bg-recessed, hairline, shared accent focus ring.
 *  Native prop pass-through — value/onChange/placeholder/id as usual. */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={className ? `input ${className}` : 'input'} />;
}

/** Select styled as `.input`; pass `<option>`s as children. */
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={className ? `input ${className}` : 'input'} />;
}
