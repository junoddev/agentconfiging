import { EmptyState } from '../components/core/index.js';

/** STUB — the per-agent list (rail `02 AGENTS`) lands in bead c6p.3, which
 *  replaces this file. Consumes data via `useAppState()`. */
export function Agents() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="agents · page pending (c6p.3)" />
      </section>
    </main>
  );
}
