import { Button } from './Button.js';
import { formatIndex, severityClass, type Severity } from './finding.js';
import './components.css';

export interface FindingRowProps {
  /** 1-based timetable index, rendered 2-digit mono ("01"). */
  index: number;
  severity: Severity;
  /** Finding title — imperative voice (§7). */
  title: string;
  /** Optional fix line, rendered as `→ fix …` under the title. */
  fix?: string;
  /** Present only when a machine-applicable fix exists; renders [APPLY]. */
  onApply?: () => void;
}

/** Timetable finding row (DESIGN.md §6): 2-digit mono index · 8px severity
 *  block · title · `→ fix` line · [APPLY] when a machine fix exists. */
export function FindingRow({ index, severity, title, fix, onApply }: FindingRowProps) {
  return (
    <div className="finding">
      <span className="mono-data finding__index">{formatIndex(index)}</span>
      <span className={`sev ${severityClass(severity)}`} role="img" aria-label={severity} />
      <span className="finding__body">
        <span className="finding__title">{title}</span>
        {fix !== undefined && <span className="mono-data finding__fix">→ {fix}</span>}
      </span>
      {onApply && <Button label="apply" onClick={onApply} />}
    </div>
  );
}
