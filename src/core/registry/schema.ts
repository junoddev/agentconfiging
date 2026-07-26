/**
 * Registry schema (SPEC §4.5) — the typed model for the catalog & registry.
 *
 * A RegistryIndex is the static index the external `agentconfig-registry`
 * repo publishes (and that a seed snapshot ships in-package, see ./seed).
 * Each RegistryEntry mirrors a detected artifact: it names an installable
 * bundle of config files. Entries are OTHER PEOPLE'S CONFIG — untrusted
 * input. This file declares only shapes; all trust decisions live in the
 * validator (./validate.ts), the checksum verifier (./verify.ts), and, at
 * install time, the path guard (agentconfig-0zm.4). Nothing here is ever
 * executed or interpreted — entry content is rendered as text.
 */

/**
 * Artifact kinds an entry can carry. Mirrors the detectable artifact kinds
 * plus `runtime-template` (scaffold configs for a whole runtime, e.g. a
 * Cursor/Codex/Gemini starter). Template-gallery entries (SPEC §5 row 14)
 * are ordinary entries of these kinds, distinguished only by a `template`
 * tag — not a separate kind.
 */
export type RegistryEntryKind =
  'subagent' | 'skill' | 'command' | 'mcp-server' | 'hook' | 'rule' | 'runtime-template';

/** Every valid entry kind, for validation and enumeration. */
export const REGISTRY_ENTRY_KINDS: readonly RegistryEntryKind[] = [
  'subagent',
  'skill',
  'command',
  'mcp-server',
  'hook',
  'rule',
  'runtime-template',
] as const;

/**
 * One file an entry installs.
 *
 * `path` is a project-relative config destination. It is carried AS-IS and
 * is NOT trusted here: the install flow (agentconfig-0zm.4) is responsible
 * for rejecting absolute paths, `..` traversal, symlink escapes, etc. before
 * anything is written. Treating it as a plain string at this layer is
 * deliberate.
 *
 * Exactly one of `content` / `url` is the payload source:
 * - `content`: the file body, inlined in the index. Verified now against
 *   `sha256` by verifyEntry (seed + template entries are always inlined).
 * - `url`: a remote payload fetched lazily by the fetch client
 *   (agentconfig-0zm.2), which verifies the bytes against `sha256` at fetch
 *   time. url-bearing files are NOT verifiable offline.
 *
 * `sha256` is the lowercase hex SHA-256 of the payload's UTF-8 bytes.
 */
export interface RegistryFile {
  path: string;
  content?: string;
  url?: string;
  sha256: string;
}

/**
 * A catalog entry: an installable bundle of config files with provenance.
 * `source` is the provenance label recorded in installed-file frontmatter
 * (`installed-by agentconfig from <source>@<version>`) by the install flow.
 */
export interface RegistryEntry {
  kind: RegistryEntryKind;
  name: string;
  description: string;
  version: string;
  files: RegistryFile[];
  source: string;
  tags: string[];
}

/**
 * The published index: a schema `version` plus the entry list. The fetch
 * client layers a fetched index over the shipped seed (see ./loader.ts).
 */
export interface RegistryIndex {
  version: string;
  entries: RegistryEntry[];
}
