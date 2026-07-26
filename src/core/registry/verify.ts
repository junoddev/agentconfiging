/**
 * Checksum verifier (SPEC §4.5) — registry content is UNTRUSTED, so every
 * inlined file's declared `sha256` is re-derived from its bytes and compared.
 *
 * Scope: this verifies CONTENT-BEARING files (the seed and all template
 * entries inline their content). url-bearing files carry no bytes here; the
 * fetch client (agentconfig-0zm.2) verifies those against the same `sha256`
 * when it downloads them. A mismatch means the entry must be rejected before
 * anything is installed.
 *
 * Pure module: no I/O beyond node:crypto hashing of in-memory strings.
 */

import { createHash } from 'node:crypto';
import type { RegistryEntry } from './schema.js';

/** Lowercase hex SHA-256 of a string's UTF-8 bytes. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** One file whose declared digest did not match (or could not be checked). */
export interface ChecksumMismatch {
  path: string;
  expected: string;
  /** The recomputed digest, or undefined when the file carried no content. */
  actual?: string;
  reason: 'mismatch' | 'no-payload';
}

export interface VerifyResult {
  /** True when every content-bearing file matched and none were unverifiable-yet-inline. */
  ok: boolean;
  mismatches: ChecksumMismatch[];
  /** Count of url-bearing files deferred to fetch-time verification. */
  deferred: number;
}

/**
 * Verify an entry's inlined checksums. url-bearing files are counted as
 * `deferred` (verified later by the fetch client) and do not fail the result.
 * A content-bearing file whose digest differs is a `mismatch`.
 */
export function verifyEntry(entry: RegistryEntry): VerifyResult {
  const mismatches: ChecksumMismatch[] = [];
  let deferred = 0;

  for (const file of entry.files) {
    if (typeof file.content === 'string') {
      const actual = sha256Hex(file.content);
      if (actual !== file.sha256) {
        mismatches.push({ path: file.path, expected: file.sha256, actual, reason: 'mismatch' });
      }
    } else if (typeof file.url === 'string') {
      deferred += 1;
    } else {
      // Should be unreachable after validation, but never trust the input.
      mismatches.push({ path: file.path, expected: file.sha256, reason: 'no-payload' });
    }
  }

  return { ok: mismatches.length === 0, mismatches, deferred };
}
