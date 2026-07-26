import { pluralize } from './lib/format.js';

export function App() {
  return (
    <main className="app">
      <h1 className="app__title">
        agentconfig<span className="app__title-accent">.ing</span>
      </h1>
      <p className="app__status">web shell placeholder — {pluralize(0, 'finding')}</p>
    </main>
  );
}
