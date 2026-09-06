import { useEffect, useState } from 'react';
import { EmptyState, ToastProvider } from './components/core/index.js';
import { GalleryPage } from './gallery/GalleryPage.js';
import { AgentDetail } from './pages/AgentDetail.js';
import { Agents } from './pages/Agents.js';
import { Profiles } from './pages/Profiles.js';
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
import { Extensions } from './pages/Extensions.js';
import { Dashboard } from './pages/Dashboard.js';
import { Sessions } from './pages/Sessions.js';
import { Search } from './pages/Search.js';
import { ContextHealth } from './pages/ContextHealth.js';
import { Git } from './pages/Git.js';
import { Terminal } from './pages/Terminal.js';
import { Pipelines } from './pages/Pipelines.js';
import { parseRoute, type Route } from './routes.js';
import { parseGlobalKey, type CommandAction } from './command/commands.js';
import { CommandPalette } from './shell/CommandPalette.js';
import { Sidebar } from './shell/Sidebar.js';
import { StatusBar } from './shell/StatusBar.js';
import { TopBar } from './shell/TopBar.js';
import { About } from './shell/About.js';
import { Onboarding } from './shell/Onboarding.js';
import {
  readOnboarded,
  readTheme,
  resolveInitialTheme,
  shouldShowOnboarding,
  writeOnboarded,
  writeTheme,
  type Theme,
} from './shell/theme.js';
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
    case 'profiles':
      return <Profiles />;
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
    case 'extensions':
      return <Extensions />;
    case 'dashboard':
      return <Dashboard />;
    case 'sessions':
      return <Sessions />;
    case 'search':
      return <Search />;
    case 'context':
      return <ContextHealth />;
    case 'git':
      return <Git target={route.target} />;
    case 'terminal':
      // The terminal is rendered persistently at the shell (see App) so its tabs
      // + live PTYs survive navigation; the routed slot renders nothing.
      return null;
    case 'pipelines':
      return <Pipelines target={route.target} />;
    case 'gallery':
      return <GalleryPage />;
  }
}

/** App shell (opendesign/DESIGN.md §4): 49px topbar + 232px grouped sidebar +
 *  dot-grid content + 30px statusbar around a hash-route switch. Data comes
 *  from the AppStateProvider; the shell renders an honest error state (never a
 *  crash) when the session token is missing/rejected. */
export function App() {
  // Seed theme from the saved choice, falling back to the OS preference; the
  // toggle then flips + persists explicitly (see toggleTheme).
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(readTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const route = useRoute();
  const app = useAppState();

  // Cmd+K opens the command palette; Cmd+1..9 jump to the first nine sidebar pages.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // First-run onboarding (once, flag-gated) + the about dialog.
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding(readOnboarded()));
  const [aboutOpen, setAboutOpen] = useState(false);
  // ≤860px: the sidebar hides; a topbar toggle overlays it (closed on nav).
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Any navigation closes the ≤860px sidebar overlay.
  useEffect(() => {
    setNavOpen(false);
  }, [route]);

  // Flip + persist the theme. Persistence happens only on an explicit choice, so
  // an untouched install keeps following the OS preference across reloads. Both
  // the top-bar toggle and the palette's theme-toggle command route through here.
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      writeTheme(next);
      return next;
    });

  const finishOnboarding = () => {
    writeOnboarded();
    setShowOnboarding(false);
  };

  // Global shortcuts (DESIGN §6): Cmd+K palette, Cmd+1..9 page jumps. One
  // window listener, cleaned up on unmount.
  useEffect(() => {
    const isMac = /mac/i.test(navigator.platform);
    const onKey = (e: KeyboardEvent) => {
      const intent = parseGlobalKey(e, isMac);
      if (!intent) return;
      e.preventDefault();
      if (intent.type === 'open-palette') setPaletteOpen(true);
      else window.location.hash = intent.hash;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // App owns the theme, so palette actions route back through here.
  const runCommand = (action: CommandAction) => {
    switch (action.type) {
      case 'navigate':
        window.location.hash = action.hash;
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'refetch':
        app.refetch();
        break;
    }
  };

  const unauthorized = app.error?.kind === 'unauthorized';

  return (
    // One app-wide toast host (DESIGN §5): every routed page confirms
    // mutations through useToast — no page mounts its own provider.
    <ToastProvider>
      <div className="layout-shell">
        <TopBar
          route={route}
          theme={theme}
          onToggleTheme={toggleTheme}
          onAbout={() => setAboutOpen(true)}
          onToggleNav={() => setNavOpen((o) => !o)}
        />
        <div className={`app-main${navOpen ? ' nav-open' : ''}`}>
          <Sidebar route={route} />
          {/* Pages render their own <main>, so the scrollable content region is a
            div (dot grid + 980px inner column, DESIGN §4). */}
          <div className="content">
            <div className="content-inner">
              {unauthorized ? (
                <main className="layout-main page">
                  <section className="page__section">
                    <EmptyState instruction="reopen agentconfig.ing from the CLI — session token missing" />
                  </section>
                </main>
              ) : (
                <>
                  {renderRoute(route)}
                  {/* Persistent terminal: mounted once, only hidden off-route, so
                    its tabs + live PTYs survive navigation (ngs.2). */}
                  <Terminal
                    active={route.name === 'terminal'}
                    theme={theme}
                    target={route.name === 'terminal' ? route.target : undefined}
                  />
                </>
              )}
            </div>
          </div>
        </div>
        <StatusBar />
        <CommandPalette
          open={paletteOpen}
          theme={theme}
          route={route}
          onClose={() => setPaletteOpen(false)}
          onRun={runCommand}
        />
        {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
        {showOnboarding && <Onboarding onDone={finishOnboarding} />}
      </div>
    </ToastProvider>
  );
}
