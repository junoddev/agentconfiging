export type IntegrationInventoryTerm = 'Plugins' | 'Extensions';

/** Agent-native label for installed integration inventory. The API remains
 * normalized as `extensions`; only user-facing terminology adapts. */
export function integrationInventoryTerm(agentKind: string | undefined): IntegrationInventoryTerm {
  return agentKind?.toLowerCase().includes('claude') ? 'Plugins' : 'Extensions';
}

export function integrationInventoryTermLower(agentKind: string | undefined): string {
  return integrationInventoryTerm(agentKind).toLowerCase();
}
