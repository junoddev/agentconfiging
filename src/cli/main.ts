/**
 * CLI dispatch (commander) — separated from the executable entry (index.ts)
 * so tests can drive the full command surface in-process, side-effect free.
 *
 * Commands: default/`launch` (Ink UI + local server), `report` (plain JSON
 * to stdout for CI — never Ink, never color, SPEC §4), `daemon` (the headless
 * scheduler that fires scheduled pipelines — plain timestamped lines, never Ink).
 *
 * Usage errors (unknown command/flag, extra positionals) exit with
 * EX_USAGE (64) — deliberately distinct from 1, which `report` uses for
 * "warnings found" — and print the message plus usage to STDERR, keeping
 * stdout pure for machine consumers. Commander is wired with exitOverride +
 * configureOutput to guarantee both properties.
 */

import { Command, CommanderError } from 'commander';
import { runDaemon, type DaemonOptions, type DaemonDeps } from './daemon.js';
import { runLaunch, type LaunchOptions } from './launch.js';
import { REPORT_HELP, runReport, type ReportIo } from './report.js';
import { runProfilesAudit, runProfilesList, runProfilesShow } from './profiles.js';

/** BSD sysexits EX_USAGE: command line usage error. */
export const EX_USAGE = 64;

export interface CliDeps {
  /** Launch flow override for tests; defaults to the real runLaunch. */
  launch?: (opts: LaunchOptions, io: ReportIo) => Promise<number>;
  /** Daemon flow override for tests; defaults to the real runDaemon. */
  daemon?: (opts: DaemonOptions, deps: DaemonDeps) => Promise<number>;
}

function addLaunchOptions(command: Command): Command {
  return command
    .option('--no-open', 'do not open the browser (URL is still printed)')
    .option('--detach', 'quitting the UI leaves the server running')
    .option('--accept-all', 'listen on all interfaces and accept any hostname (unsafe)');
}

export async function runCli(
  argv: readonly string[],
  io: ReportIo,
  deps: CliDeps = {},
): Promise<number> {
  const launch = deps.launch ?? ((opts: LaunchOptions) => runLaunch(opts, { io }));
  const daemon = deps.daemon ?? ((opts: DaemonOptions) => runDaemon(opts, { io }));
  let code = 0;

  // Root options are parsed greedily even when they appear after the
  // `launch` subcommand name, so merge root + subcommand option bags.
  const runLaunchAction = async (opts: {
    open?: boolean;
    detach?: boolean;
    acceptAll?: boolean;
  }): Promise<void> => {
    const rootOpts = program.opts<{ open?: boolean; detach?: boolean; acceptAll?: boolean }>();
    code = await launch(
      {
        open: rootOpts.open !== false && opts.open !== false,
        detach: rootOpts.detach === true || opts.detach === true,
        ...(rootOpts.acceptAll === true || opts.acceptAll === true ? { acceptAll: true } : {}),
      },
      io,
    );
  };

  const program = new Command('agentconfiging');
  program
    .description('Local control center for AI agent configuration.')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .showHelpAfterError()
    .allowExcessArguments(false);

  // Default command: launch. Options live on the root so both
  // `agentconfiging --no-open` and `agentconfiging launch --no-open` work.
  addLaunchOptions(program).action(runLaunchAction);
  addLaunchOptions(
    program.command('launch').description('start the server and open the terminal UI (default)'),
  ).action(runLaunchAction);

  program
    .command('report')
    .description('scan a project and print a JSON report to stdout (plain, CI-safe)')
    .argument('[path]', 'project root to scan (default: current directory)')
    .option('--pretty', 'pretty-print JSON with 2-space indent')
    .option('--global', 'also scan global scope (~/.claude, ~/.codex, ...)')
    // REPORT_HELP is the canonical help text (documents exit codes and the
    // no-content guarantee); commander's generated help is bypassed.
    .helpOption(false)
    .option('-h, --help', 'show report help')
    .action((reportPath: string | undefined, opts: Record<string, unknown>) => {
      if (opts['help'] === true) {
        io.stdout(REPORT_HELP);
        return;
      }
      code = runReport(
        {
          pretty: opts['pretty'] === true,
          global: opts['global'] === true,
          ...(reportPath !== undefined ? { path: reportPath } : {}),
        },
        io,
      );
    });

  program
    .command('daemon')
    .description('run the headless scheduler that fires scheduled pipelines (plain output, no UI)')
    .option('--once', 'run every currently-due pipeline once, then exit (for cron/testing)')
    .action(async (opts: { once?: boolean }) => {
      // Never Ink, per SPEC §4 / DESIGN §8 — plain timestamped lines only.
      code = await daemon({ once: opts.once === true }, { io });
    });

  const profiles = program
    .command('profiles')
    .description('inspect and audit upstream agent profiles');
  profiles
    .command('list')
    .description('list canonical profiles as JSON')
    .action(() => {
      code = runProfilesList(io);
    });
  profiles
    .command('show')
    .argument('<id>')
    .description('show one canonical profile')
    .action((id: string) => {
      code = runProfilesShow(id, io);
    });
  profiles
    .command('audit')
    .argument('[id]')
    .description('fetch official sources and emit candidate-only drift')
    .option('--all', 'audit every canonical profile')
    .option('--cache-dir <path>')
    .option('--candidate-dir <path>')
    .option('--source <id...>', 'audit only exact canonical source ids')
    .option('--metadata-only', 'refresh conditional source metadata without extraction or diff')
    .option('--codex-assisted', 'request prose extraction (requires an isolated runner)')
    .option('--cadence <mode>', 'select daily, weekly, or monthly canonical sources')
    .action(
      async (
        id: string | undefined,
        opts: {
          cacheDir?: string;
          candidateDir?: string;
          source?: string[];
          metadataOnly?: boolean;
          codexAssisted?: boolean;
          cadence?: 'daily' | 'weekly' | 'monthly';
          all?: boolean;
        },
      ) => {
        code = await runProfilesAudit(id, opts, io);
      },
    );

  // Commander 14 treats an unknown root command as an excess argument because
  // the root command has a default action. Preserve the clearer command name in
  // the diagnostic while remaining on the Node-20-compatible Commander line.
  const rootBooleanOptions = new Set(['--no-open', '--detach', '--accept-all']);
  const firstArg = argv.find((arg) => !rootBooleanOptions.has(arg));
  if (
    firstArg !== undefined &&
    !firstArg.startsWith('-') &&
    !['launch', 'report', 'daemon', 'profiles'].includes(firstArg)
  ) {
    io.stderr(`error: unknown command '${firstArg}'\n\n${program.helpInformation()}`);
    return EX_USAGE;
  }

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version display exits 0; everything else is a usage error.
      return err.exitCode === 0 ? 0 : EX_USAGE;
    }
    throw err;
  }
  return code;
}
