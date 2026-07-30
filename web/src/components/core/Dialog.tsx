import { useEffect, useRef, type ReactNode } from 'react';
import './components.css';

export interface DialogProps {
  /** Controlled visibility. The parent owns the state; Esc and ✕ both
   *  report through `onClose`. */
  open: boolean;
  /** Sans h2 in the modal head. */
  title: ReactNode;
  /** Called whenever the dialog wants to close (✕ button, Esc/cancel). */
  onClose: () => void;
  /** Action row (`.modal-foot`), e.g. secondary Cancel + primary verb.
   *  Omit for informational dialogs. */
  footer?: ReactNode;
  /** Body content (`.modal-body`, scrolls past 60vh). */
  children: ReactNode;
}

/** Modal dialog (DESIGN.md §5): native `<dialog>`, 560px max, head/body/foot
 *  with hairline separators, fg-mix backdrop with 2px blur. Replaces
 *  `.shell-modal` and page-local ad-hoc dialogs — every modal in the app
 *  goes through this. */
export function Dialog({ open, title, onClose, footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // Guard: test environments may lack showModal.
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        // Native close (Esc) — sync the parent's state.
        if (open) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="btn-ghost" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer !== undefined && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}
