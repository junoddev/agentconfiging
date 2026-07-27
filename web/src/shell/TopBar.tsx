/**
 * Top bar (DESIGN §4/§5): 48px. Left = wordmark `AGENTCONFIG` (Archivo 700,
 * tracked). Center = the current instance's project path (mono). Right = the
 * LIVE indicator (driven by the WS state), the cost-widget placeholder slot
 * (E7 fills it), and the theme toggle.
 */

import { Button } from '../components/core/index.js';
import { LiveDot } from '../components/signal/index.js';
import type { WsState } from '../ws/client.js';
import { CostWidgetSlot } from './CostWidgetSlot.js';

export type Theme = 'paper' | 'ink';

export interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /** Open the about dialog (name / version / licence / local-only note). */
  onAbout: () => void;
  /** Absolute path of the current instance's root, or undefined before load. */
  projectPath?: string;
  /** Live-watcher connection state — LIVE pulse when connected, else OFFLINE. */
  wsState: WsState;
}

export function TopBar({ theme, onToggleTheme, onAbout, projectPath, wsState }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="wordmark">AGENTCONFIG</span>
      {/* Path is server-provided data — rendered as a text node, never HTML. */}
      <span className="mono-data topbar__path">{projectPath ?? '—'}</span>
      <LiveDot connected={wsState === 'connected'} />
      <CostWidgetSlot />
      <Button label="about" onClick={onAbout} />
      <Button label={theme === 'paper' ? 'ink' : 'paper'} onClick={onToggleTheme} />
    </header>
  );
}
