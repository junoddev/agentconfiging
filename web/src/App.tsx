import { useEffect, useState } from 'react';
import { pluralize } from './lib/format.js';

type Theme = 'paper' | 'ink';

/** Foundation proof page — exercises the Signal Grid tokens, type, and grid
 *  primitives. Seed of the component gallery (built out in a later bead). */
export function App() {
  const [theme, setTheme] = useState<Theme>('paper');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="layout-shell">
      <header className="topbar">
        <span className="wordmark">AGENTCONFIG</span>
        <span className="mono-data topbar__path">~/projects/agentconfig</span>
        <span className="live micro-label">
          <span className="live-dot" aria-hidden="true" />
          LIVE
        </span>
        <button
          type="button"
          className="btn-outline"
          onClick={() => setTheme(theme === 'paper' ? 'ink' : 'paper')}
        >
          [{theme === 'paper' ? 'INK' : 'PAPER'}]
        </button>
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

        <section className="gallery__section" id="findings">
          <h2 className="micro-label">FINDINGS</h2>
          <table className="table-hairline mono-data">
            <thead>
              <tr>
                <th className="micro-label">NO</th>
                <th className="micro-label">SEV</th>
                <th className="micro-label">FILE</th>
                <th className="micro-label">FINDING</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>01</td>
                <td>
                  <span className="sev sev--error" aria-label="error" />
                </td>
                <td>.claude/settings.local.json</td>
                <td>add to .gitignore</td>
              </tr>
              <tr>
                <td>02</td>
                <td>
                  <span className="sev sev--warn" aria-label="warning" />
                </td>
                <td>CLAUDE.md</td>
                <td>build commands section is empty</td>
              </tr>
              <tr>
                <td>03</td>
                <td>
                  <span className="sev sev--ok" aria-label="ok" />
                </td>
                <td>.agents/</td>
                <td>signal acquired</td>
              </tr>
            </tbody>
          </table>
          <p className="micro-label" style={{ marginTop: 'var(--gutter)' }}>
            {pluralize(3, 'finding').toUpperCase()} · 1 ERROR · 1 WARNING
          </p>
        </section>
      </main>
    </div>
  );
}
