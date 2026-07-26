/**
 * Registry barrel (SPEC §4.5) — the catalog schema, the untrusted-input
 * validator, the checksum verifier, and the seed loader.
 *
 * This sub-barrel is the E6 catalog foundation (agentconfig-0zm.1): pure
 * schema + validation + a thin loader over the in-package seed snapshot. The
 * fetch client (0zm.2), install UI (0zm.3) and install/path-guard (0zm.4)
 * build on these types without re-implementing the trust boundary.
 */

export type { RegistryEntryKind, RegistryFile, RegistryEntry, RegistryIndex } from './schema.js';
export { REGISTRY_ENTRY_KINDS } from './schema.js';

export { parseRegistryIndex, RegistryIndexError, LIMITS as REGISTRY_LIMITS } from './validate.js';
export type { RegistryParseResult, RegistryValidationIssue } from './validate.js';

export { verifyEntry, sha256Hex } from './verify.js';
export type { VerifyResult, ChecksumMismatch } from './verify.js';

export { loadSeed, loadSeedIndex } from './loader.js';
