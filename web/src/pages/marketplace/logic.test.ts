import { describe, expect, it } from 'vitest';
import type { InstalledPlugin, MarketplacePlugin } from '../../api/types.js';
import {
  filterPlugins,
  formatInstallCount,
  installedKeys,
  isPluginInstalled,
  pluginMatchesQuery,
} from './logic.js';

function plugin(over: Partial<MarketplacePlugin> & { id: string }): MarketplacePlugin {
  return {
    name: over.id,
    description: '',
    version: '',
    source: '',
    marketplace: '',
    ...over,
  };
}

const P = [
  plugin({ id: 'alpha@m', name: 'alpha', description: 'security scanner', installCount: 10 }),
  plugin({ id: 'beta@m', name: 'beta', description: 'design helper', installCount: 5000 }),
  plugin({ id: 'gamma@m', name: 'gamma', description: 'no count here' }),
];

describe('pluginMatchesQuery', () => {
  it('matches everything on a blank query', () => {
    expect(P.every((p) => pluginMatchesQuery(p, '  '))).toBe(true);
  });

  it('is case-insensitive AND over terms across name/description', () => {
    expect(pluginMatchesQuery(P[0]!, 'ALPHA scanner')).toBe(true);
    expect(pluginMatchesQuery(P[0]!, 'alpha design')).toBe(false);
  });
});

describe('filterPlugins', () => {
  it('sorts by install count desc, sinking absent counts, without mutating input', () => {
    const original = [...P];
    const out = filterPlugins(P, '');
    expect(out.map((p) => p.id)).toEqual(['beta@m', 'alpha@m', 'gamma@m']);
    expect(P).toEqual(original);
  });

  it('applies the query before sorting', () => {
    expect(filterPlugins(P, 'helper').map((p) => p.id)).toEqual(['beta@m']);
  });
});

describe('installed state', () => {
  const installed: InstalledPlugin[] = [
    { id: 'alpha@m', name: 'alpha', version: '1', scope: 'user', installedAt: '', source: '' },
  ];

  it('derives a key set matched by id and name', () => {
    const keys = installedKeys(installed);
    expect(isPluginInstalled(P[0]!, keys)).toBe(true);
    expect(isPluginInstalled(P[1]!, keys)).toBe(false);
  });
});

describe('formatInstallCount', () => {
  it('formats with separators and falls back for absent counts', () => {
    expect(formatInstallCount(5000)).toBe('5,000');
    expect(formatInstallCount(undefined)).toBe('—');
  });
});
