/**
 * Normalized, read-only extension inventory (agentconfig-4hm.5).
 *
 * Provider adapters own discovery and translate provider-specific state into
 * this contract. The route only accepts normalized values and creates fresh
 * wire objects, so provider output never crosses the API boundary verbatim.
 */

import type { Hono } from 'hono';

export type ExtensionProviderState =
  'supported' | 'detected' | 'unavailable' | 'unsupported' | 'error';

export type ExtensionKind = 'native' | 'config' | 'rules' | 'none';

export interface ExtensionCapabilities {
  list: boolean;
  detail: boolean;
  install: boolean;
  remove: boolean;
  update: boolean;
  enable: boolean;
  disable: boolean;
}

export interface ExtensionProvider {
  id: string;
  displayName: string;
  kind: ExtensionKind;
  state: ExtensionProviderState;
  scopes: string[];
  capabilities: ExtensionCapabilities;
  reason?: string;
}

export interface Extension {
  providerId: string;
  id: string;
  name: string;
  version: string;
  scope: string;
  source: string;
  enabled: boolean;
  kind?: ExtensionKind;
  path?: string;
}

export interface ExtensionInventoryResponse {
  providers: ExtensionProvider[];
  extensions: Extension[];
}

/** Provider-owned result after it has translated its raw state. */
export interface ExtensionInventory {
  state: ExtensionProviderState;
  extensions: readonly Extension[];
  reason?: string;
}

/** Read-only seam for provider-specific adapters. */
export interface ExtensionProviderAdapter {
  readonly provider: Omit<ExtensionProvider, 'state' | 'reason'>;
  listInstalled(): Promise<ExtensionInventory>;
}

export interface ExtensionRoutesConfig {
  adapters?: readonly ExtensionProviderAdapter[];
}

const MAX_TEXT = 500;

function safeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  })
    .join('')
    .slice(0, MAX_TEXT);
}

function safeProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeState(value: unknown): ExtensionProviderState {
  return value === 'supported' ||
    value === 'detected' ||
    value === 'unavailable' ||
    value === 'unsupported' ||
    value === 'error'
    ? value
    : 'error';
}

function safeKind(value: unknown): ExtensionKind | undefined {
  return value === 'native' || value === 'config' || value === 'rules' || value === 'none'
    ? value
    : undefined;
}

function safeCapabilities(value: unknown): ExtensionCapabilities {
  return {
    list: safeProperty(value, 'list') === true,
    detail: safeProperty(value, 'detail') === true,
    install: safeProperty(value, 'install') === true,
    remove: safeProperty(value, 'remove') === true,
    update: safeProperty(value, 'update') === true,
    enable: safeProperty(value, 'enable') === true,
    disable: safeProperty(value, 'disable') === true,
  };
}

function wireProvider(
  adapter: ExtensionProviderAdapter,
  state: ExtensionProviderState,
  reason?: unknown,
): ExtensionProvider {
  const provider = adapter.provider;
  const rawScopes = safeProperty(provider, 'scopes');
  const result: ExtensionProvider = {
    id: safeText(safeProperty(provider, 'id')),
    displayName: safeText(safeProperty(provider, 'displayName')),
    kind: safeKind(safeProperty(provider, 'kind')) ?? 'none',
    state,
    scopes: (Array.isArray(rawScopes) ? rawScopes : [])
      .filter((scope): scope is string => typeof scope === 'string')
      .map(safeText),
    capabilities: safeCapabilities(safeProperty(provider, 'capabilities')),
  };
  const safeReason = safeText(reason);
  if (safeReason !== '') result.reason = safeReason;
  return result;
}

function wireExtension(providerId: string, extension: Extension): Extension {
  const result: Extension = {
    providerId,
    id: safeText(safeProperty(extension, 'id')),
    name: safeText(safeProperty(extension, 'name')),
    version: safeText(safeProperty(extension, 'version')),
    scope: safeText(safeProperty(extension, 'scope')),
    source: safeText(safeProperty(extension, 'source')),
    enabled: safeProperty(extension, 'enabled') === true,
  };
  const kind = safeKind(safeProperty(extension, 'kind'));
  if (kind !== undefined) result.kind = kind;
  const extensionPath = safeText(safeProperty(extension, 'path'));
  if (extensionPath !== '') result.path = extensionPath;
  return result;
}

export function registerExtensionRoutes(app: Hono, config: ExtensionRoutesConfig = {}): void {
  const adapters = config.adapters ?? [];

  app.get('/api/extensions', async (c) => {
    const providers: ExtensionProvider[] = [];
    const extensions: Extension[] = [];

    for (const adapter of adapters) {
      let inventory: ExtensionInventory;
      try {
        inventory = await adapter.listInstalled();
      } catch {
        providers.push(wireProvider(adapter, 'error', 'provider inventory failed'));
        continue;
      }
      const provider = wireProvider(adapter, safeState(inventory.state), inventory.reason);
      providers.push(provider);
      if (provider.id === '') continue;
      if (Array.isArray(inventory.extensions)) {
        for (const extension of inventory.extensions) {
          if (extension !== null && typeof extension === 'object') {
            extensions.push(wireExtension(provider.id, extension));
          }
        }
      }
    }

    return c.json({ providers, extensions } satisfies ExtensionInventoryResponse);
  });
}
