/**
 * Dev-only server entry. `npm run dev:server` (tsx watch) runs THIS file, which
 * unconditionally starts the server. It is intentionally NOT part of the tsup
 * build entries, so it is never bundled into dist/cli/index.js — keeping the
 * server's auto-start out of the packaged CLI (see ./index.ts).
 */

import { startServer } from './index.js';

startServer({ root: process.cwd() }).then(
  ({ url }) => console.log(`agentconfiging server on ${url}`),
  (err: unknown) => {
    console.error(`agentconfiging server failed to start: ${String(err)}`);
    process.exitCode = 1;
  },
);
