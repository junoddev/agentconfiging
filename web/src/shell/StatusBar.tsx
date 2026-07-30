/**
 * Statusbar (opendesign/DESIGN.md §4) — NEW in E13.3: 30px, mono 11.5px
 * `--muted`. Left = pulsing live-dot + the real WS connection state
 * (connected / connecting / offline) and the server endpoint. Center = the
 * launch command. Right = config paths (global scan root · instance root).
 * `/api/health` carries no pid, so none is invented.
 */

import { isGlobalEntryError } from '../api/types.js';
import { useAppState } from '../state/index.js';

export function StatusBar() {
  const { wsState, currentInstance, globalReport } = useAppState();

  const endpoint = typeof window !== 'undefined' ? window.location.origin : '';
  const globalRoot =
    globalReport?.entries.find((e) => !isGlobalEntryError(e) && e.dir === '.claude')?.root ??
    globalReport?.entries[0]?.root;

  return (
    <footer className="statusbar">
      <span className={`live live--${wsState}`} role="status">
        <span className="live-dot" aria-hidden="true" />
        {wsState}
      </span>
      <span className="sb-endpoint">{endpoint}</span>
      <span className="sb-cmd">$ npx agentconfiging</span>
      <span className="right">
        {globalRoot !== undefined && <span className="sb-path">{globalRoot}</span>}
        {globalRoot !== undefined && currentInstance !== undefined && <span>·</span>}
        {currentInstance !== undefined && <span className="sb-path">{currentInstance.root}</span>}
      </span>
    </footer>
  );
}
