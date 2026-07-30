import { fileChipTitle } from './file.js';
import './components.css';

export interface FileChipProps {
  /** File path, rendered mono. */
  path: string;
  /** Size in bytes — shown with the sha in the hover tooltip. */
  size?: number;
  /** Content hash — shown in the hover tooltip. */
  sha?: string;
  /** Open in the artifact browser. Without it the chip is inert. */
  onClick?: () => void;
}

/** Mono path chip (DESIGN.md §5 `.code`): fg-soft wash, hairline, 12px mono;
 *  hover shows size/sha via the native tooltip. Renders a real button only
 *  when clickable. */
export function FileChip({ path, size, sha, onClick }: FileChipProps) {
  const title = fileChipTitle(size, sha);
  if (onClick) {
    return (
      <button type="button" className="code" title={title} onClick={onClick}>
        {path}
      </button>
    );
  }
  return (
    <span className="code" title={title}>
      {path}
    </span>
  );
}
