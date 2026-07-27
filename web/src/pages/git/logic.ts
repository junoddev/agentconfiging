/**
 * Pure logic for the GIT PANEL page (bead ngs.1). DOM-free + React-free so the
 * load-bearing behaviour — the CONVENTIONAL-COMMIT message builder and the
 * porcelain status-letter → human label mapping — is unit-testable over plain
 * values. Git.tsx is a thin renderer over these helpers.
 *
 * Every input here is UNTRUSTED git output (a crafted branch/path/subject) or
 * user text; these functions only compose/label strings into plain values —
 * nothing produces markup. Callers render every field as a text node.
 */

import type { GitFileChange } from '../../api/types.js';

/** The conventional-commit types offered by the helper (Angular convention). */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export interface CommitParts {
  type: string;
  scope: string;
  subject: string;
  body: string;
  breaking: boolean;
}

/**
 * Build a conventional-commit message from its parts:
 *   `type(scope)!: subject` + optional blank-line body (+ BREAKING CHANGE line).
 * The scope is omitted when blank; `!` marks a breaking change. Returns '' when
 * the subject is blank (the UI disables commit on an empty result). Never throws.
 */
export function buildCommitMessage(parts: CommitParts): string {
  const type = parts.type.trim();
  const subject = parts.subject.trim();
  if (subject === '') return '';
  const scope = parts.scope.trim();
  const bang = parts.breaking ? '!' : '';
  const header = `${type}${scope !== '' ? `(${scope})` : ''}${bang}: ${subject}`;
  const body = parts.body.trim();
  const segments = [header];
  if (body !== '') segments.push(body);
  if (parts.breaking && !/\bBREAKING CHANGE\b/.test(body)) {
    segments.push(`BREAKING CHANGE: ${subject}`);
  }
  return segments.join('\n\n');
}

/** Map a porcelain-v2 status letter to a human label for the change groups. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'conflict';
    default:
      return 'changed';
  }
}

/** A short tone token for badge styling, derived from the status label group. */
export function statusTone(status: string): 'add' | 'del' | 'mod' {
  if (status === 'A' || status === 'C') return 'add';
  if (status === 'D') return 'del';
  return 'mod';
}

/** True when there is anything to stage/commit (drives empty-state + buttons). */
export function hasChanges(
  staged: readonly GitFileChange[],
  unstaged: readonly GitFileChange[],
  untracked: readonly string[],
): boolean {
  return staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
}

/** A concise ahead/behind summary, or '' when in sync / no upstream. */
export function syncSummary(ahead: number, behind: number): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.join(' ');
}
