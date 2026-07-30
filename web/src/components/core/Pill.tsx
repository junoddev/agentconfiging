import type { ReactNode } from 'react';
import './components.css';

/** ok/connected = accent-soft · warn = warn-soft · err = danger-soft ·
 *  off/disabled = fg-soft + muted. */
export type PillTone = 'ok' | 'warn' | 'err' | 'off';

export interface PillProps {
  tone: PillTone;
  /** Short mono status text, e.g. "valid", "check", "error", "disabled". */
  children: ReactNode;
}

/** Status pill (DESIGN.md §5 `.pill.p-*`): 999px radius, 11px mono, soft
 *  status wash with the full-strength hue as text — never a solid fill. */
export function Pill({ tone, children }: PillProps) {
  return <span className={`pill p-${tone}`}>{children}</span>;
}
