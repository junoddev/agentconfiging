import { sourceBadgeText, type SourceScope } from './badge.js';
import './components.css';

export interface SourceBadgeProps {
  /** Which scope the config came from — drives the label. */
  scope: SourceScope;
  /** Optional qualifier, e.g. '~/.claude' (global) or 'gitignored' (local). */
  detail?: string;
  /** Append a READ-ONLY marker (global config is never written from a project view). */
  readOnly?: boolean;
}

/** Scope-provenance micro-label (DESIGN §3/§7): `PROJECT`, `LOCAL · GITIGNORED`,
 *  `GLOBAL · ~/.claude · READ-ONLY`. Monochrome --fg-dim — provenance is
 *  chassis, not signal. */
export function SourceBadge({ scope, detail, readOnly }: SourceBadgeProps) {
  return (
    <span className="source-badge micro-label">{sourceBadgeText(scope, detail, readOnly)}</span>
  );
}
