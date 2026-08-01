import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { ExtensionProviderAdapter } from './extensions.js';

const port = 8841;
const host = `127.0.0.1:${port}`;
const token = 'extensions-session-token-extensions-session-1';
const tokenHash = createHash('sha256').update(token).digest();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-extensions-'));

function appWith(adapters: readonly ExtensionProviderAdapter[]): Hono {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(root, { makeDefault: true });
  return createApp({
    tokenHash,
    port: () => port,
    distDir: path.join(root, 'nodist'),
    registry,
    version: '1.0.0',
    extensionAdapters: adapters,
  });
}

function get(app: Hono, pathname: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${host}${pathname}`, {
        headers: { host, authorization: `Bearer ${token}` },
      }),
    ),
  );
}

describe('GET /api/extensions', () => {
  it('returns normalized provider and extension data only', async () => {
    const adapter: ExtensionProviderAdapter = {
      provider: {
        id: 'codex',
        displayName: 'Codex',
        kind: 'config',
        scopes: ['project', 'global'],
        capabilities: {
          list: true,
          detail: true,
          install: false,
          remove: false,
          update: false,
          enable: false,
          disable: false,
        },
      },
      async listInstalled() {
        return {
          state: 'detected',
          extensions: [
            {
              providerId: 'attacker-provider',
              id: 'config-1',
              name: 'AGENTS.md',
              version: '',
              scope: 'project',
              source: 'local',
              enabled: true,
              path: '/repo/AGENTS.md',
              // This is deliberately not a free-form object: raw adapter output
              // must not be able to add arbitrary keys to the response.
            },
          ],
          reason: 'safe reason',
        };
      },
    };

    const response = await get(appWith([adapter]), '/api/extensions');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          kind: 'config',
          state: 'detected',
          scopes: ['project', 'global'],
          capabilities: {
            list: true,
            detail: true,
            install: false,
            remove: false,
            update: false,
            enable: false,
            disable: false,
          },
          reason: 'safe reason',
        },
      ],
      extensions: [
        {
          providerId: 'codex',
          id: 'config-1',
          name: 'AGENTS.md',
          version: '',
          scope: 'project',
          source: 'local',
          enabled: true,
          path: '/repo/AGENTS.md',
        },
      ],
    });
  });

  it('reports adapter failures safely and preserves auth gates', async () => {
    const adapter: ExtensionProviderAdapter = {
      provider: {
        id: 'claude',
        displayName: 'Claude Code',
        kind: 'native',
        scopes: ['user'],
        capabilities: {
          list: true,
          detail: true,
          install: true,
          remove: true,
          update: true,
          enable: true,
          disable: true,
        },
      },
      async listInstalled() {
        throw new Error('provider secret');
      },
    };
    const app = appWith([adapter]);
    const response = await get(app, '/api/extensions');
    expect(await response.json()).toEqual({
      providers: [
        {
          id: 'claude',
          displayName: 'Claude Code',
          kind: 'native',
          state: 'error',
          scopes: ['user'],
          capabilities: {
            list: true,
            detail: true,
            install: true,
            remove: true,
            update: true,
            enable: true,
            disable: true,
          },
          reason: 'provider inventory failed',
        },
      ],
      extensions: [],
    });
    const unauthorized = await app.fetch(
      new Request(`http://${host}/api/extensions`, { headers: { host } }),
    );
    expect(unauthorized.status).toBe(401);
  });

  it('contains malformed adapter data at the wire boundary', async () => {
    const hostileProvider = {
      id: '<provider-id>',
      displayName: '<img src=x onerror=alert(1)>',
      kind: 'not-a-kind',
      scopes: undefined,
      capabilities: undefined,
    };
    const adapter = {
      provider: hostileProvider,
      async listInstalled() {
        return {
          state: 'not-a-state',
          extensions: [
            null,
            {
              id: '<extension-id>',
              name: '<script>alert(1)</script>',
              version: 42,
              scope: '<scope>',
              source: '<source>',
              enabled: 'yes',
              extra: 'must not cross the boundary',
            },
          ],
        };
      },
    } as unknown as ExtensionProviderAdapter;

    const response = await get(appWith([adapter]), '/api/extensions');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [
        {
          id: '<provider-id>',
          displayName: '<img src=x onerror=alert(1)>',
          kind: 'none',
          state: 'error',
          scopes: [],
          capabilities: {
            list: false,
            detail: false,
            install: false,
            remove: false,
            update: false,
            enable: false,
            disable: false,
          },
        },
      ],
      extensions: [
        {
          providerId: '<provider-id>',
          id: '<extension-id>',
          name: '<script>alert(1)</script>',
          version: '',
          scope: '<scope>',
          source: '<source>',
          enabled: false,
        },
      ],
    });
  });
});
