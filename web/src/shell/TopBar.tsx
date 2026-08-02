/**
 * Top bar (opendesign/DESIGN.md §4): 49px, `--surface`, bottom hairline.
 * Left = brand block (mono accent sigil + "agentconfig" + version from
 * GET /api/health — a dashless nothing until the probe resolves). Center =
 * persistent folder context. The folder is the application boundary, so its
 * chooser is present on every page. Agent context lives in Sidebar's Configure
 * subtree instead of competing with the folder here. Right = theme + about, as
 * `.icon-btn`s. A `.nav-toggle` icon-btn appears ≤860px where the sidebar hides.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { useAppState } from '../state/index.js';
import type { Theme as ConsoleTheme } from './theme.js';
import type { Route } from '../routes.js';

// Like the about dialog: the shell keeps its ApiClient private,
// so capture the launch token at module load for the version probe.
const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

export interface TopBarProps {
  /** Current route; omitted only for legacy standalone shell callers. */
  route?: Route;
  theme: ConsoleTheme;
  onToggleTheme: () => void;
  /** Open the about dialog (name / version / licence / local-only note). */
  onAbout: () => void;
  /** ≤860px: show/hide the overlaid sidebar. */
  onToggleNav: () => void;
}

export function TopBar({ route, theme, onToggleTheme, onAbout, onToggleNav }: TopBarProps) {
  const { instances, currentInstance, selectInstance } = useAppState();
  const [version, setVersion] = useState<string | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);
  const folderValue = currentInstance?.name ?? '—';
  void route;

  // Version probe — shows nothing (never an invented number) until it resolves.
  useEffect(() => {
    let cancelled = false;
    if (!bootToken) return;
    const client = new ApiClient(bootToken);
    void (async () => {
      try {
        const res = await client.getHealth();
        if (!cancelled) setVersion(res.version);
      } catch {
        // Probe failed — the brand block simply omits the version.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An open menu closes on any click outside the chooser and on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const pickFolder = (id: string) => {
    setMenuOpen(false);
    selectInstance(id);
  };

  const addFolder = () => {
    setMenuOpen(false);
    window.location.hash = '#/instances';
  };

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-label="Toggle navigation"
        title="Toggle navigation"
        onClick={onToggleNav}
      >
        ☰
      </button>
      <div className="brand">
        <span className="sigil" aria-hidden="true">
          ▞▚
        </span>
        <span className="name">agentconfig</span>
        {/* Server-provided data — rendered as a text node, never HTML. */}
        {version !== undefined && <span className="ver">v{version}</span>}
      </div>

      <div className="chooser folder-chooser" ref={chooserRef} aria-label="Current folder">
        <button
          type="button"
          className="ch-side"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Current folder: ${folderValue}`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="ch-label">Folder</span>
          <span className="ch-value mono">{folderValue}</span>
          <span className="ch-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {menuOpen && (
          <div className="ch-menu ch-left open" role="menu" aria-label="Folders">
            {instances.length === 0 ? (
              <div className="ch-item" aria-disabled="true">
                <span className="muted">No instances loaded</span>
              </div>
            ) : (
              instances.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  role="menuitem"
                  className={`ch-item${inst.id === currentInstance?.id ? ' active' : ''}`}
                  onClick={() => pickFolder(inst.id)}
                >
                  <span className="mono">{inst.root}</span>
                  {inst.isDefault && <span className="meta">default</span>}
                </button>
              ))
            )}
            <button type="button" role="menuitem" className="ch-item" onClick={addFolder}>
              <span>Add new</span>
              <span className="meta">Manage folders</span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="icon-btn"
        aria-label="Toggle light / dark"
        title={`Theme: ${theme} — click to toggle`}
        onClick={onToggleTheme}
      >
        ◐
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="About agentconfig"
        title="About agentconfig"
        onClick={onAbout}
      >
        ?
      </button>
    </header>
  );
}
