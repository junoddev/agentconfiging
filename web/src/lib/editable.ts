/**
 * Whether a served config file is READ-ONLY in the whole-file editors
 * (Instructions / Skills / Rules / Memory — bead agentconfig-71h.10).
 *
 * REDACTED always wins: the served text carries `[REDACTED:*]` marks in place
 * of real secrets, and saving it back would clobber them on disk (the
 * redaction-save trap). INHERITED (machine-global) files are NO LONGER forced
 * read-only — they save through the same guarded /api/write flow, and the
 * WriteFlow GLOBAL-SCOPE warning (pathScope 'global') flags every commit as
 * affecting all projects and agents on this machine. The `inherited` flag is
 * still taken so each call site records provenance at the decision point.
 */
export function fileReadOnly(opts: { redacted: boolean; inherited: boolean }): boolean {
  return opts.redacted;
}
