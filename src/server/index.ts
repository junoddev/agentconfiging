import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolveServerOptions } from './options.js';

export { LOOPBACK_HOST, resolveServerOptions } from './options.js';
export type { ServerOptions } from './options.js';

/**
 * Placeholder HTTP server so `npm run dev` has a live process.
 * Replaced by the Hono app (REST + WebSocket + static web UI) in a later bead.
 */
export function startPlaceholderServer(port?: number): ReturnType<typeof createServer> {
  const options = resolveServerOptions({ port });
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name: 'agentconfiging', status: 'placeholder' }));
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
    console.log(`agentconfiging server (placeholder) on http://${options.host}:${boundPort}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPlaceholderServer();
}
