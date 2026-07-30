import { CoreSection } from './CoreSection.js';
import { FoundationSection } from './FoundationSection.js';

/** Console spec (#/gallery): the living spec and visual regression surface for
 *  the design system. Every contract component, every shipped state; load once
 *  per theme (top-bar toggle) to verify both. Adding a component to the
 *  contract? See docs/DESIGN.md §5 — it is not shipped until it renders here. */
export function GalleryPage() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <div className="page-head">
          <div>
            <h1>Console spec</h1>
            <p className="page-sub">
              The living spec for the Console design system — every contract component, every state.
              Toggle the theme to verify light and dark. New components join the contract via{' '}
              <span className="mono">docs/DESIGN.md</span> §5 and a demo on this page.
            </p>
          </div>
        </div>
      </section>

      <hr className="rule-h" />
      <FoundationSection />
      <hr className="rule-h" />
      <CoreSection />
    </main>
  );
}
