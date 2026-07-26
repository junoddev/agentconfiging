/**
 * Registry validator (SPEC §4.5) — the trust boundary for UNTRUSTED registry
 * content. `parseRegistryIndex` takes an already-JSON-parsed `unknown` (the
 * fetched or seed index) and returns a strictly-validated RegistryIndex plus
 * a report of every entry it dropped.
 *
 * Threat model — registry content is other people's config, possibly hostile:
 * - No prototype pollution: we NEVER read `__proto__`/`constructor`/
 *   `prototype` off input and NEVER merge input into an existing object. We
 *   read known keys via `Object.hasOwn` and build FRESH plain objects.
 * - No amplification: strings, arrays and entry counts are capped so a small
 *   index cannot expand into an unbounded model. The shape is flat (no
 *   recursion), so there is no deep-nesting attack surface.
 * - No execution / eval: content is copied as an opaque string, never
 *   interpreted. Path strings are carried as-is and guarded at install time.
 * - Non-fatal per entry: a malformed entry is SKIPPED and reported, never
 *   fatal. Only a structurally impossible top-level shape rejects outright.
 *
 * Pure module: no I/O.
 */

import type { RegistryEntry, RegistryFile, RegistryIndex } from './schema.js';
import { REGISTRY_ENTRY_KINDS } from './schema.js';

/** Caps. Generous for real content, tight enough to bound hostile input. */
export const LIMITS = {
  /** Max entries kept from one index. */
  maxEntries: 5000,
  /** Max files in one entry. */
  maxFilesPerEntry: 200,
  /** Max length of a short string field (name, version, source, kind, tag). */
  maxShortString: 512,
  /** Max length of a description. */
  maxDescription: 4096,
  /** Max length of a file path. */
  maxPath: 1024,
  /** Max length of an inlined file content string. */
  maxContent: 1_000_000,
  /** Max length of a url string. */
  maxUrl: 2048,
  /** Max tags on one entry. */
  maxTags: 64,
  /** Max length of a sha256 hex digest (exactly 64, capped defensively). */
  maxSha: 128,
} as const;

/** A dropped entry and why — surfaced to the caller, never thrown. */
export interface RegistryValidationIssue {
  /** Index of the offending entry in the source array, or -1 for index-level. */
  entryIndex: number;
  /** The entry's declared name if we could read one, else undefined. */
  name?: string;
  /** Bounded, control-char-scrubbed reason. */
  reason: string;
}

export interface RegistryParseResult {
  /** The validated index — contains ONLY entries that passed. */
  index: RegistryIndex;
  /** One issue per skipped entry (and any recoverable index-level notes). */
  issues: RegistryValidationIssue[];
}

/** Thrown only when the top-level shape is unusable (not per-entry). */
export class RegistryIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryIndexError';
  }
}

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read an own, non-reserved property; undefined for inherited/reserved keys. */
function own(obj: Record<string, unknown>, key: string): unknown {
  if (RESERVED_KEYS.has(key)) return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** Bound + scrub a string that may quote hostile content, for diagnostics. */
function scrub(raw: string): string {
  let clean = '';
  for (let i = 0; i < raw.length && clean.length < 200; i += 1) {
    const c = raw.charCodeAt(i);
    clean += c < 0x20 || c === 0x7f ? ' ' : raw.charAt(i);
  }
  return clean || 'unknown';
}

/** A non-empty string within `max`, else undefined. */
function shortString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > max) return undefined;
  return value;
}

class EntryError extends Error {}

function requireString(value: unknown, max: number, field: string): string {
  const s = shortString(value, max);
  if (s === undefined) throw new EntryError(`${field} must be a string of 1..${max} chars`);
  return s;
}

function validateFile(input: unknown, i: number): RegistryFile {
  if (!isPlainObject(input)) throw new EntryError(`files[${i}] must be an object`);
  const path = requireString(own(input, 'path'), LIMITS.maxPath, `files[${i}].path`);
  const sha256 = requireString(own(input, 'sha256'), LIMITS.maxSha, `files[${i}].sha256`);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new EntryError(`files[${i}].sha256 must be 64 lowercase hex chars`);
  }

  const rawContent = own(input, 'content');
  const rawUrl = own(input, 'url');
  const hasContent = rawContent !== undefined;
  const hasUrl = rawUrl !== undefined;
  if (hasContent === hasUrl) {
    throw new EntryError(`files[${i}] must have exactly one of content or url`);
  }

  const file: RegistryFile = { path, sha256 };
  if (hasContent) {
    if (typeof rawContent !== 'string' || rawContent.length > LIMITS.maxContent) {
      throw new EntryError(`files[${i}].content must be a string <= ${LIMITS.maxContent} chars`);
    }
    file.content = rawContent;
  } else {
    const url = requireString(rawUrl, LIMITS.maxUrl, `files[${i}].url`);
    // Carry only http(s) payload URLs; anything else is refused here.
    if (!/^https?:\/\//i.test(url)) throw new EntryError(`files[${i}].url must be http(s)`);
    file.url = url;
  }
  return file;
}

function validateTags(input: unknown): string[] {
  if (!Array.isArray(input)) throw new EntryError('tags must be an array');
  if (input.length > LIMITS.maxTags) throw new EntryError(`tags exceeds ${LIMITS.maxTags}`);
  const tags: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    tags.push(requireString(input[i], LIMITS.maxShortString, `tags[${i}]`));
  }
  return tags;
}

/** Validate one entry into a FRESH object, or throw EntryError describing why. */
function validateEntry(input: unknown): RegistryEntry {
  if (!isPlainObject(input)) throw new EntryError('entry must be an object');

  const kind = requireString(own(input, 'kind'), LIMITS.maxShortString, 'kind');
  if (!(REGISTRY_ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw new EntryError(`kind '${scrub(kind)}' is not a known artifact kind`);
  }

  const rawFiles = own(input, 'files');
  if (!Array.isArray(rawFiles)) throw new EntryError('files must be an array');
  if (rawFiles.length === 0) throw new EntryError('files must not be empty');
  if (rawFiles.length > LIMITS.maxFilesPerEntry) {
    throw new EntryError(`files exceeds ${LIMITS.maxFilesPerEntry}`);
  }
  const files = rawFiles.map((f, i) => validateFile(f, i));

  return {
    kind: kind as RegistryEntry['kind'],
    name: requireString(own(input, 'name'), LIMITS.maxShortString, 'name'),
    description: requireString(own(input, 'description'), LIMITS.maxDescription, 'description'),
    version: requireString(own(input, 'version'), LIMITS.maxShortString, 'version'),
    files,
    source: requireString(own(input, 'source'), LIMITS.maxShortString, 'source'),
    tags: validateTags(own(input, 'tags')),
  };
}

/**
 * Validate an untrusted, JSON-parsed registry index. Throws RegistryIndexError
 * only for an unusable top-level shape; otherwise returns the surviving
 * entries plus an issue per dropped entry.
 */
export function parseRegistryIndex(input: unknown): RegistryParseResult {
  if (!isPlainObject(input)) throw new RegistryIndexError('index must be an object');

  const version = shortString(own(input, 'version'), LIMITS.maxShortString);
  if (version === undefined) {
    throw new RegistryIndexError('index.version must be a non-empty string');
  }

  const rawEntries = own(input, 'entries');
  if (!Array.isArray(rawEntries)) throw new RegistryIndexError('index.entries must be an array');
  if (rawEntries.length > LIMITS.maxEntries) {
    throw new RegistryIndexError(`index.entries exceeds ${LIMITS.maxEntries}`);
  }

  const entries: RegistryEntry[] = [];
  const issues: RegistryValidationIssue[] = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const raw = rawEntries[i];
    try {
      entries.push(validateEntry(raw));
    } catch (error) {
      const name =
        isPlainObject(raw) && typeof own(raw, 'name') === 'string'
          ? scrub(own(raw, 'name') as string)
          : undefined;
      const reason = error instanceof Error ? scrub(error.message) : 'invalid entry';
      issues.push({ entryIndex: i, name, reason });
    }
  }

  return { index: { version, entries }, issues };
}
