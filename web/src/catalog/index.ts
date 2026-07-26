/** Public surface of the CATALOG browse + install/remove experience (beads
 *  agentconfig-0zm.4 install flow, 0zm.3 browse: shelves, search, quick-add). */
export { CatalogCard, type CatalogCardProps } from './CatalogCard.js';
export { QuickAdd, type QuickAddProps } from './QuickAdd.js';
export { RuntimeScaffold, type RuntimeScaffoldProps } from './RuntimeScaffold.js';
export {
  KNOWN_RUNTIMES,
  RUNTIME_TEMPLATE_KIND,
  buildRuntimeSetups,
  detectedKindSet,
  partitionRuntimeSetups,
  runtimeTemplateEntries,
  type KnownRuntime,
  type RuntimeSetup,
} from './runtimeSetup.js';
export {
  useCatalogFlow,
  type CatalogAction,
  type CatalogFlowController,
  type CatalogFlowOptions,
  type CatalogFlowPhase,
  type InstallFilePreview,
} from './useCatalogFlow.js';
export {
  DEFAULT_SHELVES,
  EMPTY_FILTER,
  INSTALLABLE_KINDS,
  TEMPLATE_TAG,
  entryMatchesQuery,
  filterEntries,
  installedByKey,
  installedCount,
  isInstalled,
  kindsPresent,
  quickAddCandidates,
  shelveEntries,
  templateCount,
  type CatalogFilter,
  type Shelf,
  type ShelfSpec,
} from './logic.js';
