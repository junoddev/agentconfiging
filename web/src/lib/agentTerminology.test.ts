import { describe, expect, it } from 'vitest';
import { integrationInventoryTerm } from './agentTerminology.js';

describe('integrationInventoryTerm', () => {
  it('uses agent-native inventory terminology', () => {
    expect(integrationInventoryTerm('claude-code')).toBe('Plugins');
    expect(integrationInventoryTerm('codex')).toBe('Extensions');
    expect(integrationInventoryTerm('gemini-cli')).toBe('Extensions');
    expect(integrationInventoryTerm(undefined)).toBe('Extensions');
  });
});
