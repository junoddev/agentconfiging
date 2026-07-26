import { EmptyState } from '../components/core/index.js';

/** STUB — the artifact browser (rail `04 ARTIFACTS`) lands in bead c6p.4, which
 *  replaces this file. It reads file content via the API's getFile (redaction is
 *  applied there) and renders content as text nodes only. */
export function Artifacts() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="artifacts · page pending (c6p.4)" />
      </section>
    </main>
  );
}
