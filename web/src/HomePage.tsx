import { EmptyState } from './components/core/index.js';

/** Dashboard placeholder — the real dashboard lands in E4. Until the
 *  watcher exists there is genuinely no signal. */
export function HomePage() {
  return (
    <main className="layout-main page">
      <section className="page__section">
        <EmptyState instruction="add a folder to begin watching" />
      </section>
    </main>
  );
}
