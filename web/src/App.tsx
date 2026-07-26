import { useEffect, useState } from 'react';
import {
  Button,
  DiffPanel,
  EmptyState,
  FileChip,
  FindingRow,
  SignalStrip,
  StatBlock,
  Table,
  type DiffHunk,
} from './components/core/index.js';
import {
  LiveDot,
  SweepOverlay,
  VuMeter,
  Waveform,
  type ConfigSource,
} from './components/signal/index.js';
import { pluralize } from './lib/format.js';

type Theme = 'paper' | 'ink';

/** Fake manifest for the waveform proof — the real one comes from the core. */
const FAKE_SOURCES: ConfigSource[] = [
  { path: 'CLAUDE.md', size: 3120, hash: 'a1b2c3d4' },
  { path: '.claude/settings.json', size: 512, hash: '9f8e7d6c' },
];
const FAKE_SOURCES_ALT: ConfigSource[] = [
  { path: 'AGENTS.md', size: 5934, hash: '11aa22bb' },
  { path: '.codex/config.toml', size: 244, hash: 'cc33dd44' },
];

/** Fake parsed diff for the DiffPanel proof — the real model comes from the core. */
const FAKE_DIFF: DiffHunk[] = [
  {
    header: '@@ -1,3 +1,4 @@',
    lines: [
      { kind: 'ctx', text: 'node_modules/' },
      { kind: 'ctx', text: 'dist/' },
      { kind: 'del', text: '.env' },
      { kind: 'add', text: '.env*' },
      { kind: 'add', text: '.claude/settings.local.json' },
    ],
  },
];

/** Foundation proof page — exercises the Signal Grid tokens, type, and grid
 *  primitives. Seed of the component gallery (built out in a later bead). */
export function App() {
  const [theme, setTheme] = useState<Theme>('paper');
  const [connected, setConnected] = useState(true);
  const [pulseKey, setPulseKey] = useState(0);
  const [sweepKey, setSweepKey] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="layout-shell">
      <header className="topbar">
        <span className="wordmark">AGENTCONFIG</span>
        <span className="mono-data topbar__path">~/projects/agentconfig</span>
        <LiveDot connected={connected} />
        <Button
          label={theme === 'paper' ? 'ink' : 'paper'}
          onClick={() => setTheme(theme === 'paper' ? 'ink' : 'paper')}
        />
      </header>

      <nav className="rail" aria-label="Sections">
        <a className="micro-label rail__item" href="#signal" aria-current="true">
          01 SIGNAL
        </a>
        <a className="micro-label rail__item" href="#agents">
          02 AGENTS
        </a>
        <a className="micro-label rail__item" href="#findings">
          03 FINDINGS
        </a>
        <a className="micro-label rail__item" href="#components">
          04 COMPONENTS
        </a>
      </nav>

      <main className="layout-main gallery">
        <section className="gallery__section" id="signal">
          <h1 className="micro-label">SIGNAL</h1>
          <div className="grid-page">
            <div className="stat" style={{ gridColumn: 'span 4' }}>
              <div className="numeral-giant">2</div>
              <div className="micro-label">AGENTS</div>
            </div>
            <div className="stat col-rule" style={{ gridColumn: 'span 4' }}>
              <div className="numeral-giant">3</div>
              <div className="micro-label">WARNINGS</div>
            </div>
            <div className="stat col-rule" style={{ gridColumn: 'span 4' }}>
              <div className="numeral-giant--sm numeral-giant">14</div>
              <div className="micro-label">
                ARTIFACTS <span className="mono-data stat__delta">+3</span>
              </div>
            </div>
          </div>
        </section>

        <hr className="rule-h" />

        <section className="gallery__section" id="agents">
          <h2 className="micro-label">SIGNAL LAYER</h2>
          <div className="surface sweep-panel">
            <div className="row" style={{ gap: 'var(--gutter)' }}>
              <Waveform sources={FAKE_SOURCES} pulseKey={pulseKey} label="claude fingerprint" />
              <VuMeter level={0.9} label="claude confidence" />
              <span className="mono-data">CLAUDE.md · 2 FILES</span>
            </div>
            <div className="row" style={{ gap: 'var(--gutter)', borderBottom: 0 }}>
              <Waveform sources={FAKE_SOURCES_ALT} pulseKey={pulseKey} label="codex fingerprint" />
              <VuMeter level={0.65} label="codex confidence" />
              <span className="mono-data">AGENTS.md · 2 FILES</span>
            </div>
            <div className="row" style={{ gap: 'var(--gutter)', borderBottom: 0 }}>
              <VuMeter level={0.2} label="cache efficiency" />
              <VuMeter level={0} label="token budget" />
              <Button label="file event" onClick={() => setPulseKey((k) => k + 1)} />
              <Button label="rescan" onClick={() => setSweepKey((k) => k + 1)} />
              <Button
                label={connected ? 'disconnect' : 'connect'}
                onClick={() => setConnected((c) => !c)}
              />
            </div>
            <SweepOverlay sweepKey={sweepKey} />
          </div>
        </section>

        <hr className="rule-h" />

        <section className="gallery__section" id="findings">
          <h2 className="micro-label">FINDINGS</h2>
          <FindingRow
            index={1}
            severity="error"
            title=".claude/settings.local.json is committed"
            fix="add to .gitignore"
          />
          <FindingRow
            index={2}
            severity="warn"
            title="CLAUDE.md build commands section is empty"
            fix="add build & test commands"
          />
          <FindingRow index={3} severity="ok" title="SIGNAL ACQUIRED" />
          <p className="micro-label" style={{ marginTop: 'var(--gutter)' }}>
            {pluralize(3, 'finding').toUpperCase()} · 1 ERROR · 1 WARNING
          </p>
        </section>

        <hr className="rule-h" />

        <section className="gallery__section" id="components">
          <h2 className="micro-label">COMPONENTS</h2>

          <div className="gallery__demo">
            <h3 className="micro-label">STATBLOCK</h3>
            <div className="grid-page">
              <div style={{ gridColumn: 'span 3' }}>
                <StatBlock value={2} label="AGENTS" size="md" />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <StatBlock value={3} label="WARNINGS" delta={-1} size="md" />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <StatBlock value={14} label="ARTIFACTS" delta={3} size="md" />
              </div>
            </div>
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">SIGNALSTRIP</h3>
            <SignalStrip
              kind="CLAUDE"
              sources={FAKE_SOURCES}
              confidence={0.9}
              fileCount={2}
              pulseKey={pulseKey}
            />
            <SignalStrip
              kind="CODEX"
              sources={FAKE_SOURCES_ALT}
              confidence={0.65}
              fileCount={2}
              pulseKey={pulseKey}
            />
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">FINDINGROW</h3>
            <FindingRow
              index={1}
              severity="error"
              title="settings.local.json is committed"
              fix="add .claude/settings.local.json to .gitignore"
              onApply={() => setSweepKey((k) => k + 1)}
            />
            <FindingRow
              index={2}
              severity="warn"
              title="CLAUDE.md build commands section is empty"
              fix="add build & test commands"
            />
            <FindingRow index={3} severity="ok" title="SIGNAL ACQUIRED" />
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">FILECHIP</h3>
            <div className="gallery__chips">
              <FileChip
                path="CLAUDE.md"
                size={3120}
                sha="a1b2c3d4"
                onClick={() => setPulseKey((k) => k + 1)}
              />
              <FileChip path=".claude/settings.json" size={512} sha="9f8e7d6c" />
              <FileChip path=".codex/config.toml" />
            </div>
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">DIFFPANEL</h3>
            <DiffPanel
              label=".gitignore"
              hunks={FAKE_DIFF}
              onCommit={() => setSweepKey((k) => k + 1)}
              onDiscard={() => setPulseKey((k) => k + 1)}
            />
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">BUTTONS</h3>
            <div className="gallery__chips">
              <Button label="apply" variant="primary" />
              <Button label="discard" variant="destructive" />
              <Button label="install" />
              <Button label="offline" disabled />
            </div>
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">TABLE</h3>
            <Table headers={['NO', 'KIND', 'FILES']}>
              <tr>
                <td>01</td>
                <td>CLAUDE</td>
                <td>2</td>
              </tr>
              <tr>
                <td>02</td>
                <td>CODEX</td>
                <td>2</td>
              </tr>
            </Table>
          </div>

          <div className="gallery__demo">
            <h3 className="micro-label">EMPTYSTATE</h3>
            <EmptyState instruction="add a folder to begin watching" />
          </div>
        </section>
      </main>
    </div>
  );
}
