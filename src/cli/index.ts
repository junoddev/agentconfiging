#!/usr/bin/env node
import { runCli } from './main.js';

export { COMMANDS, parseCliArgs } from './args.js';
export type { Command, ParsedArgs, ReportArgs } from './args.js';
export { EX_USAGE, runCli } from './main.js';
export { runReport, REPORT_HELP } from './report.js';
export type { ReportFinding, ReportIo, ReportOptions } from './report.js';
export { collectPathCommands } from './path-env.js';

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (chunk) => void process.stdout.write(chunk),
  stderr: (chunk) => void process.stderr.write(chunk),
});
