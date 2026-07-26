/**
 * Discovery barrel — recursive agent-project walker (SPEC §4.2).
 */

export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_DIRS,
  DiscoveryError,
  discoverProjects,
} from './discovery.js';
export type {
  DiscoverOptions,
  DiscoveryErrorCode,
  DiscoveryHit,
  DiscoveryResult,
  DiscoveryStats,
} from './discovery.js';
export { DIR_MARKERS, FILE_MARKERS } from './markers.js';
