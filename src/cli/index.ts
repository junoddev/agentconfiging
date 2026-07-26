#!/usr/bin/env node
import { runCli } from './main.js';

export { EX_USAGE, runCli } from './main.js';
export type { CliDeps } from './main.js';
export { runReport, REPORT_HELP } from './report.js';
export type { ReportFinding, ReportIo, ReportOptions } from './report.js';
export { collectPathCommands } from './path-env.js';
export { buildOpenCommand, runLaunch } from './launch.js';
export type { LaunchDeps, LaunchOptions, ServerFactory, ServerHandle } from './launch.js';
export {
  addInstance,
  addInstances,
  createInstanceList,
  formatHeader,
  formatInstanceRow,
  markLoaded,
  moveSelection,
  selectedInstance,
} from './instances.js';
export type { Instance, InstanceList } from './instances.js';
export { createFileLogger, logFileName, resolveLogDir } from './logs.js';
export type { LogEntry, LogLevel } from './logs.js';
export { colorEnabled, resolveRenderMode } from './tty.js';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (chunk) => void process.stdout.write(chunk),
  stderr: (chunk) => void process.stderr.write(chunk),
});
