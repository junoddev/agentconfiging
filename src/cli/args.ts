/**
 * Command + flag parsing per SPEC §4: default launch, `report` (plain JSON
 * to stdout, never Ink), `daemon`.
 *
 * Deliberately hand-rolled instead of commander: the flag surface is three
 * booleans and one positional, which does not justify a runtime dependency.
 * Revisit when Ink + the full command tree arrive (E2).
 */

export const COMMANDS = ['launch', 'report', 'daemon'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ReportArgs {
  command: 'report';
  /** Optional project root; defaults to cwd at execution time. */
  path?: string;
  /** Pretty-print JSON with 2-space indent (default: compact). */
  pretty: boolean;
  /** Also scan global scope (~/.claude, ~/.codex, ...). */
  global: boolean;
  /** Print report usage and exit. */
  help: boolean;
}

export type ParsedArgs = { command: 'launch' | 'daemon' } | ReportArgs;

function parseReportArgs(rest: readonly string[]): ReportArgs {
  const args: ReportArgs = { command: 'report', pretty: false, global: false, help: false };
  for (const arg of rest) {
    if (arg === '--pretty') args.pretty = true;
    else if (arg === '--global') args.global = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown flag for report: ${arg}`);
    else if (args.path !== undefined) throw new Error(`unexpected extra argument: ${arg}`);
    else args.path = arg;
  }
  return args;
}

/** Parse process argv (already stripped of node + script). */
export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined) return { command: 'launch' };
  if (first === 'report') return parseReportArgs(rest);
  if (first === 'launch' || first === 'daemon') return { command: first };
  throw new Error(`unknown command: ${first} (expected one of ${COMMANDS.join(', ')})`);
}
