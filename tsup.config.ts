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
  // Must be false: with ESM + multiple entries, tsup's default code-splitting
  // hoists shared modules into a top-level `dist/chunk-*.js`. Runtime paths that
  // are computed relative to `import.meta.url` — the server's `dist/web` static
  // root and the `package.json` version read, both `new URL('../../…')` assuming
  // the module lives at `dist/<name>/index.js` — then resolve one directory too
  // high (outside the package), so the launched server 404s the entire web UI.
  // Self-contained entries keep every module at its expected depth.
  splitting: false,
  // Must be false: tsup's `clean` always wipes the ENTIRE outDir (an array only
  // adds patterns, it does not restrict). Since the web bundle also lives under
  // dist (dist/web, built by `vite build web`), `clean: true` — or any array —
  // would destroy it, so a stray `npx tsup` silently nuked the web UI.
  // Instead, the `build` script runs `clean:tsup` first to remove only tsup's
  // own outputs (dist/cli, dist/server, dist/core, dist/*.js); vite's
  // emptyOutDir handles dist/web.
  clean: false,
});
