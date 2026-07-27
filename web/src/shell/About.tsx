/**
 * About dialog (E10 qoc.2, SPEC §5 row 20). A hairline dialog with the app name,
 * version, licence, and the local-only assurance. Opened from the top bar; the
 * shell mounts it only while open, so the version probe runs on open and never
 * before.
 *
 * VERSION: read from the token-gated `GET /api/health` ({ ok, version }) — the
 * web bundle can't import package.json at runtime, and this avoids baking a
 * build-time constant. The dialog shows a dash until the probe resolves and on
 * any failure — never an invented number. No external fetch of any kind.
 *
 * DESIGN §9: hairline panel over a faint scrim — NO blur/glass/shadow. §7 voice.
 * All copy is a text node; tokens only.
 */

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ApiClient } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { Button } from '../components/core/index.js';
import { displayVersion } from './theme.js';
import './shell.css';

// The shell keeps its ApiClient private, so — like the cost widget — capture the
// launch token at module load and build a private client for the health probe.
const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

export interface AboutProps {
  onClose: () => void;
}

export function About({ onClose }: AboutProps) {
  const [version, setVersion] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!bootToken) return;
    const client = new ApiClient(bootToken);
    void (async () => {
      try {
        const res = await client.getHealth();
        if (!cancelled) setVersion(res.version);
      } catch {
        // Probe failed — the version stays a dash rather than an invented number.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="shell-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="shell-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="about agentconfig"
        onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
      >
        <h2 className="shell-modal__title">AGENTCONFIG</h2>
        <p className="shell-modal__lead">A local control center for AI-agent configuration.</p>
        <div className="shell-modal__rows">
          <div className="shell-modal__row">
            <span className="shell-modal__row-key">Version</span>
            <span className="shell-modal__row-val">{displayVersion(version)}</span>
          </div>
          <div className="shell-modal__row">
            <span className="shell-modal__row-key">License</span>
            <span className="shell-modal__row-val">MIT</span>
          </div>
          <div className="shell-modal__row">
            <span className="shell-modal__row-key">Runs</span>
            <span className="shell-modal__row-val">
              Locally. The session token stays in memory and is never written to disk.
            </span>
          </div>
        </div>
        <p className="shell-modal__note">agentconfiging · npx agentconfiging</p>
        <div className="shell-modal__actions">
          <Button label="close" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
