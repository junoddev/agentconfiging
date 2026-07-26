import { CoreSection } from './CoreSection.js';
import { FoundationSection } from './FoundationSection.js';
import { SignalSection } from './SignalSection.js';

/** Internal component gallery (#/gallery): the living spec and visual
 *  regression surface. Every component, every state; load once per theme
 *  (top-bar toggle) to verify both. */
export function GalleryPage() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="micro-label">00 GALLERY · INTERNAL</h1>
        <p className="mono-data">EVERY COMPONENT · EVERY STATE · TOGGLE THEME TO VERIFY BOTH</p>
      </section>

      <hr className="rule-h" />
      <FoundationSection />
      <hr className="rule-h" />
      <SignalSection />
      <hr className="rule-h" />
      <CoreSection />
    </main>
  );
}
