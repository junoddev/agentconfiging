/**
 * `agentconfiging report` — the full engine over a directory, JSON to stdout.
 *
 * PLAIN output per SPEC §4: never Ink, never color. stdout carries EXACTLY
 * one JSON document (machine-parseable, zero non-JSON bytes); diagnostics go
 * to stderr. Pipeline: scanProject/scanGlobal → detect → buildReport
 * (input building + parsing + analyzers, all in src/core).
 *
 * Output stays LEAN and CONTENT-FREE: each scope reports paths/metadata/
 * findings — root, scope, localOnly, detected agents, findings, scan stats.
 * Manifest file CONTENT is never serialized, and that includes finding fix
 * payloads: `Finding.fix.edits[].patch` is complete replacement file content
 * (which can embed secrets, e.g. env values in settings.json), so findings
 * are serialized with the fix summarized as `hasFix: true` + `fixKind`
 * instead. Global-scope data is localOnly; redaction applies at render time
 * elsewhere, not here.
 *
 * Exit codes: 0 = no findings above info, 1 = warnings, 2 = errors,
 * 3 = engine failure (structured error JSON on stdout, message on stderr),
 * 64 = usage error (see main.ts). A global config dir that trips a scan cap
 * does NOT fail the run: it becomes an inline `{root, scope, localOnly,
 * error}` entry while the project and other global dirs survive.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReport,
  detect,
  KNOWN_DIRS,
  ScanError,
  scanGlobal,
  scanProject,
  toReportFinding,
  type AnalyzerEnv,
  type DetectedAgent,
  type Manifest,
  type ManifestStats,
  type ReportFinding,
} from '../core/index.js';
import { collectPathCommands } from './path-env.js';

export const REPORT_HELP = `Usage: agentconfiging report [path] [options]

Scan a project for AI agent configuration and print a JSON report to stdout.
Exit code reflects the most severe finding.

Arguments:
  path          project root to scan (default: current directory)

Options:
  --pretty      pretty-print JSON with 2-space indent (default: compact)
  --global      also scan global scope (~/.claude, ~/.codex, ...) and include
                one report per global config dir. Global output is local-only
                (each entry carries localOnly: true): it stays on this machine
                and must not be uploaded; redaction is applied at render time,
                not here. A global dir that exceeds scan caps becomes an
                inline error entry without failing the rest of the report.
  -h, --help    show this help

Output is plain JSON only (no color, no Ink) and carries paths, metadata,
findings, and stats — never file contents. Machine-fix payloads (complete
replacement file bodies) are summarized as hasFix/fixKind; patch content is
never serialized.

Exit codes:
  0   no findings above info
  1   at least one warning
  2   at least one error
  3   engine failure (structured error JSON on stdout)
  64  usage error (message + this help on stderr)
`;

export interface ReportOptions {
  /** Project root to scan; defaults to process.cwd(). */
  path?: string;
  /** Pretty-print with 2-space indent. */
  pretty?: boolean;
  /** Also scan global scope under homeDir. */
  global?: boolean;
  /** Home directory for --global (default os.homedir(); injectable for tests). */
  homeDir?: string;
  /** PATH string for the analyzer env bag (default process.env.PATH; injectable). */
  pathEnv?: string;
}

export interface ReportIo {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

/**
 * A finding as serialized in report output — shared with the server API.
 * `Finding.fix` is never serialized; see ReportFinding in src/core/report.ts
 * (moved there by agentconfig-gxo.2 so CLI and server share one stripper).
 */
export type { ReportFinding } from '../core/index.js';

/** One scanned scope, content-free: paths/metadata/findings only. */
interface ScopeReport {
  root: string;
  scope: 'project' | 'global';
  /** True for global scope: data must never leave the machine. */
  localOnly: boolean;
  agents: DetectedAgent[];
  findings: ReportFinding[];
  stats: ManifestStats;
}

interface SerializedError {
  name: string;
  code?: string;
  message: string;
}

/** A global config dir whose scan failed (caps tripped); rest of the report survives. */
interface GlobalScanFailure {
  root: string;
  scope: 'global';
  localOnly: true;
  error: SerializedError;
}

type GlobalEntry = ScopeReport | GlobalScanFailure;

interface ReportHeader {
  version: string;
  generatedAt: string;
}

type ReportPayload =
  (ReportHeader & ScopeReport) | (ReportHeader & { project: ScopeReport; global: GlobalEntry[] });

function packageVersion(): string {
  // Works from both src/cli (tsx/vitest) and the bundled dist/cli/index.js:
  // package.json is two levels up either way.
  try {
    const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function serializeError(err: unknown): SerializedError {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    message: error.message,
  };
}

function scopeReport(manifest: Manifest, env: AnalyzerEnv | undefined): ScopeReport {
  const agents = detect(manifest);
  const { findings } = buildReport(manifest, agents, env);
  return {
    root: manifest.root,
    scope: manifest.scope ?? 'project',
    localOnly: manifest.localOnly ?? false,
    agents,
    findings: findings.map(toReportFinding),
    stats: manifest.stats,
  };
}

/**
 * Scan the global config dirs with per-dir error isolation. scanGlobal is
 * all-or-nothing (one oversized ~/.cursor would abort every dir), so on
 * ScanError we rescan each candidate dir in isolation — via a throwaway
 * temp home containing a single symlink, which scanGlobal explicitly
 * supports (dotfile-manager symlinks are realpath'd) — salvaging healthy
 * dirs and reporting offenders as inline error entries.
 */
function scanGlobalEntries(
  homeDir: string,
  env: AnalyzerEnv | undefined,
  io: ReportIo,
): GlobalEntry[] {
  try {
    return scanGlobal(homeDir).map((m) => scopeReport(m, env));
  } catch (err) {
    if (!(err instanceof ScanError)) throw err;
  }

  const entries: GlobalEntry[] = [];
  for (const dir of KNOWN_DIRS) {
    const target = path.join(homeDir, dir);
    try {
      if (!fs.statSync(target).isDirectory()) continue;
    } catch {
      continue; // missing dir — same silent skip as scanGlobal
    }

    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-global-'));
    try {
      const link = path.join(fakeHome, dir);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      entries.push(...scanGlobal(fakeHome).map((m) => scopeReport(m, env)));
    } catch (err) {
      const error = serializeError(err);
      entries.push({ root: target, scope: 'global', localOnly: true, error });
      io.stderr(`agentconfiging report: skipping global dir ${target}: ${error.message}\n`);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  }
  return entries;
}

function exitCodeFor(findings: readonly ReportFinding[]): 0 | 1 | 2 {
  if (findings.some((f) => f.severity === 'error')) return 2;
  if (findings.some((f) => f.severity === 'warning')) return 1;
  return 0;
}

/**
 * Run the report pipeline and write the JSON document to io.stdout.
 * Returns the process exit code. Never throws; engine failures become a
 * structured error JSON on stdout, a message on stderr, and exit code 3.
 */
export function runReport(opts: ReportOptions, io: ReportIo): number {
  const header: ReportHeader = {
    version: packageVersion(),
    generatedAt: new Date().toISOString(),
  };
  const indent = opts.pretty ? 2 : undefined;
  const emit = (payload: unknown) => io.stdout(`${JSON.stringify(payload, null, indent)}\n`);

  try {
    // Empty collection result is treated as "fact unavailable" (e.g. PATH
    // unreadable) so PATH-gated checks skip instead of guessing wrong.
    const pathCommands = collectPathCommands(opts.pathEnv ?? process.env['PATH']);
    const env: AnalyzerEnv | undefined = pathCommands.length > 0 ? { pathCommands } : undefined;
    const project = scopeReport(scanProject(opts.path ?? process.cwd()), env);

    if (!opts.global) {
      emit({ ...header, ...project });
      return exitCodeFor(project.findings);
    }

    const globals = scanGlobalEntries(opts.homeDir ?? os.homedir(), env, io);
    emit({ ...header, project, global: globals } satisfies ReportPayload);
    const surviving = globals.filter((e): e is ScopeReport => !('error' in e));
    return exitCodeFor([project, ...surviving].flatMap((s) => s.findings));
  } catch (err) {
    const error = serializeError(err);
    emit({ ...header, error });
    io.stderr(`agentconfiging report: ${error.message}\n`);
    return 3;
  }
}
