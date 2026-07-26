/**
 * CLI dispatch — separated from the executable entry (index.ts) so tests
 * can drive the full command surface in-process, side-effect free.
 *
 * Usage errors (unknown command/flag, extra positionals) exit with
 * EX_USAGE (64) — deliberately distinct from 1, which `report` uses for
 * "warnings found" — and print the message plus usage to STDERR, keeping
 * stdout pure for machine consumers.
 */

import { parseCliArgs } from './args.js';
import { REPORT_HELP, runReport, type ReportIo } from './report.js';

/** BSD sysexits EX_USAGE: command line usage error. */
export const EX_USAGE = 64;

export function runCli(argv: readonly string[], io: ReportIo): number {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`agentconfiging: ${message}\n\n${REPORT_HELP}`);
    return EX_USAGE;
  }

  switch (parsed.command) {
    case 'report':
      // Plain JSON to stdout for CI — never Ink, never color (SPEC §4).
      if (parsed.help) {
        io.stdout(REPORT_HELP);
        return 0;
      }
      return runReport(
        {
          pretty: parsed.pretty,
          global: parsed.global,
          ...(parsed.path !== undefined ? { path: parsed.path } : {}),
        },
        io,
      );
    case 'daemon':
      io.stdout('agentconfiging daemon: not implemented yet\n');
      return 0;
    case 'launch':
      io.stdout('agentconfiging: launch UI not implemented yet\n');
      return 0;
  }
}
