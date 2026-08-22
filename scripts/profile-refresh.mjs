import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function value(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

const profile = value('agent');
const mode = value('mode', 'weekly');
const source = value('source');
const output = path.resolve(value('output', 'profile-refresh-output'));
const cache = path.resolve(value('cache', '.cache/profile-audit'));
const dryRun = process.argv.includes('--dry-run');
const RUN_TIMEOUT_MS = 5 * 60_000;
if (!profile || !['daily', 'weekly', 'monthly'].includes(mode)) {
  process.stderr.write('usage: profile-refresh --agent <id> --mode daily|weekly|monthly\n');
  process.exit(64);
}
fs.mkdirSync(output, { recursive: true });
for (const stale of ['result.json', 'run.json', 'stderr.log'])
  fs.rmSync(path.join(output, stale), { force: true });
const candidateDir = path.join(output, 'candidates');
if (mode === 'monthly' || process.argv.includes('--force'))
  fs.rmSync(cache, { recursive: true, force: true });
const args = [
  'exec',
  '--yes',
  '--',
  'tsx',
  'src/cli/index.ts',
  'profiles',
  'audit',
  profile,
  '--cache-dir',
  cache,
  '--candidate-dir',
  candidateDir,
  '--cadence',
  mode,
];
if (source) args.push('--source', source);
if (mode === 'daily') args.push('--metadata-only');
const result = spawnSync('npm', args, {
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
  timeout: RUN_TIMEOUT_MS,
  killSignal: 'SIGKILL',
  maxBuffer: 4 * 1024 * 1024,
});
fs.writeFileSync(path.join(output, 'result.json'), result.stdout || '{}\n', { flag: 'w' });
let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  report = undefined;
}
for (const evidence of report?.evidence ?? []) {
  if (!/^sha256:[a-f0-9]{64}$/.test(evidence?.contentHash ?? '')) continue;
  const targetDir = path.join(output, 'evidence', 'sha256');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(evidence.cachePath, path.join(targetDir, evidence.contentHash.slice(7)));
}
if (result.stderr) fs.writeFileSync(path.join(output, 'stderr.log'), result.stderr, { flag: 'w' });
const code = result.status ?? 3;
const complete =
  (code === 0 || code === 1) &&
  report?.profileId === profile &&
  (report.status === 'clean' || report.status === 'drift') &&
  (report.unresolvedSourceIds?.length ?? 0) === 0;
fs.writeFileSync(
  path.join(output, 'run.json'),
  `${JSON.stringify({ schemaVersion: 1, profileId: profile, mode, exitCode: code, complete, unresolvedSourceIds: report?.unresolvedSourceIds ?? [] })}\n`,
);
// Drift is an expected review outcome. Transport/validation failures remain isolated job failures.
if (code === 1 && report?.status === 'drift') process.exit(0);
if (dryRun && code === 0) process.exit(0);
process.exit(code);
