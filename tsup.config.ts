import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'server/index': 'src/server/index.ts',
    'core/index': 'src/core/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // No sourcemaps in the published build: this is a CLI, and the maps would
  // reference `src/`, which is not shipped in the tarball (files: ["dist"]).
  // Shipping them produced dead maps and ~1MB of tarball bloat.
  sourcemap: false,
  // Must be false: tsup's `clean` always wipes the ENTIRE outDir (an array only
  // adds patterns, it does not restrict). Since the web bundle also lives under
  // dist (dist/web, built by `vite build web`), `clean: true` — or any array —
  // would destroy it, so a stray `npx tsup` silently nuked the web UI.
  // Instead, the `build` script runs `clean:tsup` first to remove only tsup's
  // own outputs (dist/cli, dist/server, dist/core, dist/*.js); vite's
  // emptyOutDir handles dist/web.
  clean: false,
});
