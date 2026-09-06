import { describe, expect, it } from 'vitest';
import type { Extension, ExtensionProvider } from '../../api/types.js';
import { capabilityLabels, filterExtensions, groupExtensions } from './logic.js';

const provider: ExtensionProvider = {
  id: 'codex',
  displayName: 'Codex',
  kind: 'native',
  state: 'supported',
  scopes: ['global', 'project'],
  capabilities: {
    list: true,
    detail: false,
    install: false,
    remove: false,
    update: false,
    enable: false,
    disable: false,
  },
};
const extension = (overrides: Partial<Extension> = {}): Extension => ({
  providerId: 'codex',
  id: 'one',
  name: 'One',
  version: '1.0',
  scope: 'project',
  source: 'disk',
  enabled: true,
  ...overrides,
});

describe('extensions logic', () => {
  it('groups inventory by provider and scope', () => {
    expect(
      groupExtensions([provider], [extension(), extension({ scope: 'global', id: 'two' })]).map(
        (g) => g.scope,
      ),
    ).toEqual(['global', 'project']);
  });
  it('filters by provider and searchable metadata', () => {
    expect(
      filterExtensions(
        [extension(), extension({ providerId: 'other', name: 'Two' })],
        'disk',
        'codex',
      ),
    ).toHaveLength(1);
  });
  it('exposes only capabilities the provider actually supports', () => {
    expect(capabilityLabels(provider)).toEqual(['list']);
  });
});
