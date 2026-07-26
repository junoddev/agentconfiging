import { Button } from './Button.js';
import { diffLineClass, diffLinePrefix, type DiffHunk } from './diff.js';
import './components.css';

export interface DiffPanelProps {
  /** Parsed diff model — parsing raw diff text is not this component's job. */
  hunks: readonly DiffHunk[];
  /** Panel caption (usually the file path), rendered as a micro-label. */
  label?: string;
  onCommit?: () => void;
  onDiscard?: () => void;
}

/** Unified diff panel (DESIGN.md §6): mono 13, add lines `--signal`, del
 *  lines `--red`; mandatory before any write. All diff content is rendered
 *  as text nodes only — never as markup. */
export function DiffPanel({ hunks, label, onCommit, onDiscard }: DiffPanelProps) {
  return (
    <div className="diff surface">
      {label !== undefined && <div className="micro-label diff__label">{label}</div>}
      <div className="diff__body">
        {hunks.map((hunk, h) => (
          <div key={h}>
            <div className="mono-data diff__header">{hunk.header}</div>
            {hunk.lines.map((line, i) => (
              <div key={i} className={`mono-data ${diffLineClass(line.kind)}`}>
                {diffLinePrefix(line.kind) + line.text}
              </div>
            ))}
          </div>
        ))}
      </div>
      {(onCommit ?? onDiscard) && (
        <div className="diff__actions">
          {onCommit && <Button label="commit" variant="primary" onClick={onCommit} />}
          {onDiscard && <Button label="discard" variant="destructive" onClick={onDiscard} />}
        </div>
      )}
    </div>
  );
}
