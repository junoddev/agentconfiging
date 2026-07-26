import { EmptyState } from '../components/core/index.js';

/** STUB — the per-agent detail view (route `#/agent/:kind`) lands in bead c6p.3,
 *  which replaces this file. The `kind` param comes from the route. */
export function AgentDetail({ kind }: { kind: string }) {
  return (
    <main className="layout-main page">
      <section className="page__section">
        {/* `kind` is route-derived text — rendered as a text node, never HTML. */}
        <EmptyState instruction={`agent · ${kind} · page pending (c6p.3)`} />
      </section>
    </main>
  );
}
