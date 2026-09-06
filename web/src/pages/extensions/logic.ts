import type { Extension, ExtensionProvider } from '../../api/types.js';

export interface ExtensionGroup {
  provider: ExtensionProvider;
  scope: string;
  extensions: Extension[];
}

export function filterExtensions(
  extensions: Extension[],
  query: string,
  providerId: string,
): Extension[] {
  const needle = query.trim().toLowerCase();
  return extensions.filter((extension) => {
    if (providerId !== 'all' && extension.providerId !== providerId) return false;
    if (needle === '') return true;
    return [extension.name, extension.id, extension.source, extension.scope, extension.version]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

export function groupExtensions(
  providers: ExtensionProvider[],
  extensions: Extension[],
): ExtensionGroup[] {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const groups = new Map<string, ExtensionGroup>();
  for (const extension of extensions) {
    const provider = providerMap.get(extension.providerId);
    if (!provider) continue;
    const key = `${provider.id}\u0000${extension.scope}`;
    const existing = groups.get(key);
    if (existing) existing.extensions.push(extension);
    else groups.set(key, { provider, scope: extension.scope, extensions: [extension] });
  }
  return [...groups.values()].sort((a, b) =>
    `${a.provider.displayName}\u0000${a.scope}`.localeCompare(
      `${b.provider.displayName}\u0000${b.scope}`,
    ),
  );
}

export function capabilityLabels(provider: ExtensionProvider): string[] {
  return (['list', 'detail', 'install', 'remove', 'update', 'enable', 'disable'] as const).filter(
    (capability) => provider.capabilities[capability],
  );
}
