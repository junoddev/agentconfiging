import { themeTokens, type ColorTokenName } from '../styles/tokens.js';

const TOKEN_NAMES = Object.keys(themeTokens.paper) as ColorTokenName[];

/** Foundation swatches: color tokens (rendered through the live theme),
 *  type scale specimens, and the grid primitives. Chassis only. */
export function FoundationSection() {
  return (
    <section className="page__section" id="foundation">
      <h2 className="micro-label">FOUNDATION</h2>

      <div className="gallery__demo">
        <h3 className="micro-label">COLOR TOKENS</h3>
        {TOKEN_NAMES.map((name) => (
          <div key={name} className="swatch-row">
            <span className="swatch" style={{ background: `var(${name})` }} aria-hidden="true" />
            <span className="mono-data swatch-row__name">{name}</span>
            <span className="mono-data swatch-row__values">
              {themeTokens.paper[name]} · {themeTokens.ink[name]}
            </span>
          </div>
        ))}
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">TYPE SCALE</h3>
        <div className="numeral-giant">96</div>
        <div className="numeral-giant numeral-giant--sm">64</div>
        <div className="title-page">Page title · Archivo 600 · 28</div>
        <div className="title-section">Section header · Archivo 600 · 18</div>
        <p>Body 15 — legibility earns trust before writes.</p>
        <div className="mono-data">mono-data 13 · .claude/settings.json · a1b2c3d4</div>
        <div className="micro-label">MICRO-LABEL 11 · +0.08EM TRACKING</div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">GRID</h3>
        <div className="grid-page">
          <div className="grid-demo-cell" style={{ gridColumn: 'span 4' }}>
            <span className="micro-label">SPAN 4</span>
          </div>
          <div className="grid-demo-cell col-rule" style={{ gridColumn: 'span 4' }}>
            <span className="micro-label">SPAN 4 · COL RULE</span>
          </div>
          <div className="grid-demo-cell col-rule" style={{ gridColumn: 'span 4' }}>
            <span className="micro-label">SPAN 4 · COL RULE</span>
          </div>
        </div>
        <hr className="rule-h" />
        <div className="row">
          <span className="mono-data">40PX ROW · HAIRLINE RULED · NO ZEBRA</span>
        </div>
        <div className="surface grid-demo-surface">
          <span className="micro-label">SURFACE · ELEVATION = HAIRLINE + SURFACE SHIFT</span>
        </div>
      </div>
    </section>
  );
}
