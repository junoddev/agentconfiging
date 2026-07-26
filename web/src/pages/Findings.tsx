import { EmptyState } from '../components/core/index.js';

/** STUB — the findings list (rail `03 FINDINGS`) lands in bead c6p.5, which
 *  replaces this file. Consumes data via `useAppState()`. */
export function Findings() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="findings · page pending (c6p.5)" />
      </section>
    </main>
  );
}
