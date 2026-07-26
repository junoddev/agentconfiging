import { EmptyState } from '../components/core/index.js';

/** STUB — the instance/workspace manager (rail `05 INSTANCES`) lands in bead
 *  c6p.6, which replaces this file. Consumes the instance list + `selectInstance`
 *  from `useAppState()`. */
export function Instances() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="instances · page pending (c6p.6)" />
      </section>
    </main>
  );
}
