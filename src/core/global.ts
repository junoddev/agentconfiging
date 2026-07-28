/**
 * Global-scope scan + report composition (SPEC §4.1) — the shared engine
 * behind CLI `report --global` and the server's global report, so both
 * build identical entries from one implementation (agentconfig-71h.1;
 * lifted from src/cli/report.ts).
 *
 * Each existing KNOWN_DIRS entry under `homeDir` (~/.claude, ~/.codex, ...)
 * becomes one envelope entry: scan → detect → buildReport, serialized
 * CONTENT-FREE. Findings go through toReportFinding, so `Finding.fix`
 * (complete replacement file bodies, which can embed secrets) is never
 * present — only hasFix/fixKind.
 *
 * Per-dir error isolation: scanGlobal is all-or-nothing (one oversized
 * ~/.cursor would abort every dir), so on ScanError each candidate dir is
 * rescanned in isolation — via a throwaway temp home containing a single
 * symlink, which scanGlobal explicitly supports (dotfile-manager symlinks
 * are realpath'd) — salvaging healthy dirs and reporting offenders as
 * inline GlobalEntryError entries.
 *
 * This module does fs I/O (temp-home fallback) by composing the scanner;
 * everything downstream of the scan stays pure.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect, type DetectedAgent } from './detectors/index.js';
import type { Manifest, ManifestStats } from './manifest.js';
import { KNOWN_DIRS, ScanError, scanGlobal } from './scanner.js';
import { buildReport, toReportFinding, type AnalyzerEnv, type ReportFinding } from './report.js';

/** One successfully scanned global config dir, content-free. */
export interface GlobalEntry {
  /** Real path of the config dir (symlinks resolved by the scanner). */
  root: string;
  /** Well-known dir name under home (e.g. '.claude') — the manifest's cwdBasename. */
  dir: string;
  agents: DetectedAgent[];
  findings: ReportFinding[];
  stats: ManifestStats;
}

/** A global config dir whose scan failed (caps tripped); siblings survive. */
export interface GlobalEntryError {
  /** Logical path under home (join, not realpath — the dir may be unreadable). */
  root: string;
  /** Well-known dir name under home (e.g. '.cursor'). */
  dir: string;
  error: { name: string; code?: string; message: string };
}

function serializeError(err: unknown): GlobalEntryError['error'] {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    message: error.message,
  };
}

/** Run detect + buildReport over one global manifest into an envelope entry. */
export function buildGlobalEntry(manifest: Manifest, env?: AnalyzerEnv): GlobalEntry {
  const agents = detect(manifest);
  const { findings } = buildReport(manifest, agents, env);
  return {
    root: manifest.root,
    dir: manifest.cwdBasename,
    agents,
    findings: findings.map(toReportFinding),
    stats: manifest.stats,
  };
}

/**
 * Scan every global config dir under `homeDir` with per-dir error isolation
 * (see module docstring) and compose one entry per dir. Missing dirs are
 * skipped silently, like scanGlobal. Non-ScanError failures on the fast
 * path rethrow (engine bug, not a cap); inside the isolation loop ANY
 * failure becomes that dir's error entry so siblings still report.
 */
export function buildGlobalEntries(
  homeDir: string,
  env?: AnalyzerEnv,
): (GlobalEntry | GlobalEntryError)[] {
  try {
    return scanGlobal(homeDir).map((m) => buildGlobalEntry(m, env));
  } catch (err) {
    if (!(err instanceof ScanError)) throw err;
  }

  const entries: (GlobalEntry | GlobalEntryError)[] = [];
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
      entries.push(...scanGlobal(fakeHome).map((m) => buildGlobalEntry(m, env)));
    } catch (err) {
      // `dir` may be nested ('.github/copilot'); success entries carry the
      // manifest's cwdBasename ('copilot'), so normalize to match.
      entries.push({ root: target, dir: path.basename(dir), error: serializeError(err) });
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  }
  return entries;
}
