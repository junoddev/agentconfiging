/**
 * About dialog (E10 qoc.2, reskinned onto the shared Dialog in E13.3). App
 * name, version, licence, and the local-only assurance. Opened from the top
 * bar; the shell mounts it only while open, so the version probe runs on open
 * and never before.
 *
 * VERSION: read from the token-gated `GET /api/health` ({ ok, version }) — the
 * web bundle can't import package.json at runtime, and this avoids baking a
 * build-time constant. The dialog shows a dash until the probe resolves and on
 * any failure — never an invented number. No external fetch of any kind.
 */

import { useEffect, useState } from 'react';
import { ApiClient } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { Button, Dialog } from '../components/core/index.js';
import { displayVersion } from './theme.js';
import './shell.css';

// The shell keeps its ApiClient private, so — like the cost widget — capture the
// launch token at module load and build a private client for the health probe.
const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

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

  return (
    <Dialog
      open
      title="About agentconfig"
      onClose={onClose}
      footer={<Button label="Close" onClick={onClose} />}
    >
      <p className="shell-lead">A local control center for AI-agent configuration.</p>
      <div className="shell-rows">
        <div className="shell-row">
          <span className="shell-row__key">Version</span>
          <span className="shell-row__val mono">{displayVersion(version)}</span>
        </div>
        <div className="shell-row">
          <span className="shell-row__key">License</span>
          <span className="shell-row__val">MIT</span>
        </div>
        <div className="shell-row">
          <span className="shell-row__key">Runs</span>
          <span className="shell-row__val">
            Locally. The session token stays in memory and is never written to disk.
          </span>
        </div>
      </div>
      <p className="meta shell-note">agentconfiging · npx agentconfiging</p>
    </Dialog>
  );
}
