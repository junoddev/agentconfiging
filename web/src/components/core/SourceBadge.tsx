import { scopeClass, sourceBadgeText, type SourceScope } from './badge.js';
import './components.css';

export interface SourceBadgeProps {
  /** Which scope the config came from — drives the label and the tint. */
  scope: SourceScope;
  /** Optional qualifier, e.g. '~/.claude' (global) or 'gitignored' (local). */
  detail?: string;
  /** Append a READ-ONLY marker (global config is never written from a project view). */
  readOnly?: boolean;
}

/** Scope badge (DESIGN.md §5 `.scope.s-*`) — the system's signature; every
 *  configurable row shows one. project = accent-soft · global = outlined
 *  neutral (the Console "user" treatment, keeping the GLOBAL label + path
 *  detail) · local = warn-soft · default = dashed (effective-config default,
 *  no source file). */
export function SourceBadge({ scope, detail, readOnly }: SourceBadgeProps) {
  return (
    <span className={`scope ${scopeClass(scope)} source-badge`}>
      {sourceBadgeText(scope, detail, readOnly)}
    </span>
  );
}
