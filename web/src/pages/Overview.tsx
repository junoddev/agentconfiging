import { EmptyState } from '../components/core/index.js';

/** STUB — the overview dashboard (rail `01 SIGNAL`) lands in bead c6p.2, which
 *  replaces this file. It consumes data via `useAppState()` / `useReport()`. */
export function Overview() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="overview · page pending (c6p.2)" />
      </section>
    </main>
  );
}
