import type { ReactNode } from 'react';
import './components.css';

export interface NoticeProps {
  /** warn (default) = warn-soft wash · info = accent-soft wash. */
  tone?: 'warn' | 'info';
  /** Body copy; say what's missing and the nearest equivalent — never fake
   *  parity ("Codex has no lifecycle hooks…"). */
  children: ReactNode;
}

/** Notice (DESIGN.md §5 `.notice[-info]`): soft wash, 35%-mix border, mono
 *  glyph mark (▲). Used for capability gaps and inline guidance. */
export function Notice({ tone = 'warn', children }: NoticeProps) {
  return (
    <div className={tone === 'info' ? 'notice notice-info' : 'notice'}>
      <span className="n-mark" aria-hidden="true">
        ▲
      </span>
      <div>{children}</div>
    </div>
  );
}
