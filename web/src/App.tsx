import { useEffect, useState } from 'react';
import { EmptyState } from './components/core/index.js';
import { GalleryPage } from './gallery/GalleryPage.js';
import { AgentDetail } from './pages/AgentDetail.js';
import { Agents } from './pages/Agents.js';
import { Artifacts } from './pages/Artifacts.js';
import { Findings } from './pages/Findings.js';
import { Instances } from './pages/Instances.js';
import { Overview } from './pages/Overview.js';
import { Settings } from './pages/Settings.js';
import { Instructions } from './pages/Instructions.js';
import { Skills } from './pages/Skills.js';
import { Hooks } from './pages/Hooks.js';
import { Rules } from './pages/Rules.js';
import { Memory } from './pages/Memory.js';
import { Mcp } from './pages/Mcp.js';
import { Keybindings } from './pages/Keybindings.js';
import { Sync } from './pages/Sync.js';
import { Catalog } from './pages/Catalog.js';
import { Marketplace } from './pages/Marketplace.js';
import { parseRoute, type Route } from './routes.js';
import { Rail } from './shell/Rail.js';
import { TopBar, type Theme } from './shell/TopBar.js';
import { useAppState } from './state/index.js';

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

/** Route → page component. Each page is a c6p.2-6 stub for now; swapping a stub
 *  never touches this switch beyond the import. */
function renderRoute(route: Route) {
  switch (route.name) {
    case 'overview':
      return <Overview />;
    case 'agents':
      return <Agents />;
    case 'agent':
      return <AgentDetail kind={route.kind} />;
    case 'findings':
      return <Findings />;
    case 'artifacts':
      return <Artifacts />;
    case 'instances':
      return <Instances />;
    case 'settings':
      return <Settings />;
    case 'instructions':
      return <Instructions />;
    case 'skills':
      return <Skills />;
    case 'hooks':
      return <Hooks />;
    case 'rules':
      return <Rules />;
    case 'memory':
      return <Memory />;
    case 'mcp':
      return <Mcp />;
    case 'keybindings':
      return <Keybindings />;
    case 'sync':
      return <Sync />;
    case 'catalog':
      return <Catalog />;
    case 'marketplace':
      return <Marketplace />;
    case 'gallery':
      return <GalleryPage />;
  }
}

/** App shell (DESIGN §4): top bar + left rail chrome around a hash-route switch.
 *  Data comes from the AppStateProvider; the shell renders an honest error state
 *  (never a crash) when the session token is missing/rejected. */
export function App() {
  // Seed theme from the OS preference; the toggle flips explicitly thereafter.
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper',
  );
  const route = useRoute();
  const app = useAppState();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const unauthorized = app.error?.kind === 'unauthorized';

  return (
    <div className="layout-shell">
      <TopBar
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'paper' ? 'ink' : 'paper')}
        projectPath={app.currentInstance?.root}
        wsState={app.wsState}
      />
      <Rail route={route} />
      {unauthorized ? (
        <main className="layout-main page">
          <section className="page__section">
            <EmptyState instruction="reopen agentconfig from the CLI — session token missing" />
          </section>
        </main>
      ) : (
        renderRoute(route)
      )}
    </div>
  );
}
