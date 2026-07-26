/**
 * Minimal command parsing per SPEC §4: default launch, `report` (plain JSON
 * to stdout, never Ink), `daemon`. Ink + commander arrive in a later bead.
 */

export const COMMANDS = ['launch', 'report', 'daemon'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command: Command;
}

/** Parse process argv (already stripped of node + script). */
export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const [first] = argv;
  if (first === undefined) {
    return { command: 'launch' };
  }
  if ((COMMANDS as readonly string[]).includes(first)) {
    return { command: first as Command };
  }
  throw new Error(`unknown command: ${first} (expected one of ${COMMANDS.join(', ')})`);
}
