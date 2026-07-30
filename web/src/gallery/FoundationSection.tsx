import { derivedTokens, themeTokens, type ColorTokenName } from '../styles/tokens.js';

const TOKEN_NAMES = Object.keys(themeTokens.light) as ColorTokenName[];
const SOFT_NAMES = Object.keys(derivedTokens) as (keyof typeof derivedTokens)[];

/** Foundation — Console tokens rendered through the live theme, the fixed-px
 *  type scale, and the shape primitives. Flip the theme toggle to verify the
 *  light and dark values side by side. */
export function FoundationSection() {
  return (
    <section className="page__section" id="foundation">
      <h2 className="table-header">Foundation · §1–§3</h2>

      <div className="gallery__demo">
        <h3 className="micro-label">COLOR TOKENS · LIGHT / DARK</h3>
        {TOKEN_NAMES.map((name) => (
          <div key={name} className="swatch-row">
            <span className="swatch" style={{ background: `var(${name})` }} aria-hidden="true" />
            <span className="mono-data swatch-row__name">{name}</span>
            <span className="mono-data swatch-row__values">
              {themeTokens.light[name]} · {themeTokens.dark[name]}
            </span>
          </div>
        ))}
        {SOFT_NAMES.map((name) => (
          <div key={name} className="swatch-row">
            <span className="swatch" style={{ background: `var(${name})` }} aria-hidden="true" />
            <span className="mono-data swatch-row__name">{name}</span>
            <span className="mono-data swatch-row__values">{derivedTokens[name]}</span>
          </div>
        ))}
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">TYPE SCALE · FIXED PX</h3>
        <h1>Page title · 20 / 650</h1>
        <h2>Card head · 15 / 600</h2>
        <p>Body 13.5 / 1.5 — labels are nouns, buttons are verbs that say what happens.</p>
        <div className="mono-data">mono-data 12.5 · .claude/settings.json · a1b2c3d4</div>
        <div className="meta">meta 12 mono muted · updated 3d ago</div>
        <div className="table-header">TABLE HEADER · 11 MONO · 0.05EM</div>
        <div className="micro-label">MICRO LABEL · 10 MONO · 0.08EM</div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">SHAPE · HAIRLINES DO THE SEPARATION WORK</h3>
        <div className="row">
          <span className="mono-data">hairline row · no zebra · hover carries fg-soft</span>
        </div>
        <div className="surface grid-demo-surface">
          <span className="micro-label">SURFACE · RADIUS-LG · NO SHADOW AT REST</span>
        </div>
      </div>
    </section>
  );
}
