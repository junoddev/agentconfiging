import { useEffect, useState } from 'react';
import { Button } from './components/core/index.js';
import { LiveDot } from './components/signal/index.js';
import { GalleryPage } from './gallery/GalleryPage.js';
import { HomePage } from './HomePage.js';
import { parseRoute, routeHash, type Route } from './routes.js';

type Theme = 'paper' | 'ink';

/** Current hash route, kept in sync with `hashchange`. */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

/** App shell: top bar + rail chrome (DESIGN.md §4) around a hash-route
 *  switch. `#/gallery` is the internal component gallery; the default
 *  route is a placeholder until the real dashboard (E4). */
export function App() {
  // Seed from the OS preference so a system-dark user lands on Ink instead
  // of always being pinned to Paper; the toggle flips explicitly thereafter.
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper',
  );
  const route = useRoute();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="layout-shell">
      <header className="topbar">
        <span className="wordmark">AGENTCONFIG</span>
        <span className="mono-data topbar__path">~/projects/agentconfig</span>
        {/* No watcher yet (E4) — the dot honestly reads OFFLINE. */}
        <LiveDot connected={false} />
        <Button
          label={theme === 'paper' ? 'ink' : 'paper'}
          onClick={() => setTheme(theme === 'paper' ? 'ink' : 'paper')}
        />
      </header>

      <nav className="rail" aria-label="Sections">
        <a
          className="micro-label rail__item"
          href={routeHash('home')}
          aria-current={route === 'home' ? 'page' : undefined}
        >
          01 SIGNAL
        </a>
        <hr className="rule-h rail__break" />
        <a
          className="micro-label rail__item"
          href={routeHash('gallery')}
          aria-current={route === 'gallery' ? 'page' : undefined}
        >
          00 GALLERY
        </a>
      </nav>

      {route === 'gallery' ? <GalleryPage /> : <HomePage />}
    </div>
  );
}
