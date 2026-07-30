import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import './components.css';

/** §5: toast shows for 2.2s, then drops. */
export const TOAST_DURATION_MS = 2200;

type ToastFn = (message: string) => void;

const ToastContext = createContext<ToastFn | null>(null);

/** Show a confirmation toast, e.g. `toast('Hook saved')`. Every mutating
 *  action confirms through this. Requires a `<ToastProvider>` ancestor. */
export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (toast === null) throw new Error('useToast requires a <ToastProvider> ancestor');
  return toast;
}

/** Single app-wide toast host (DESIGN.md §5 `.toast`): inverted fg/bg, mono
 *  12px, fixed bottom-right. One instance — a new message replaces the
 *  current one and restarts the 2.2s clock. Mount once in the shell (the
 *  gallery mounts its own for demos). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((next: string) => {
    setMessage(next);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={show ? 'toast mono show' : 'toast mono'} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
