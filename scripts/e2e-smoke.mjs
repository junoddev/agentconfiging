#!/usr/bin/env node
/**
 * E2E packaging smoke test — the E11 DEMO GATE.
 *
 * Proves `npx agentconfiging` works for a fresh user, end to end, from the
 * packed tarball — WITHOUT relying on the optional native modules
 * (better-sqlite3, node-pty) building. It:
 *
 *   1. builds a fresh dist          (npm run build)
 *   2. packs the publish tarball    (npm pack)
 *   3. installs it into a CLEAN throwaway consumer package in os.tmpdir
 *      via a REAL `npm install <abs-path-to-tgz>` — exactly as a user would.
 *      The install forces `--omit=optional`, then proves the native modules are
 *      absent and the core package still works.
 *   4. runs the installed bin `agentconfiging report <fixture>` and asserts the
 *      stdout is a single valid JSON document with the expected shape, and the
 *      exit code is severity-based (0/1/2).
 *   5. LAUNCH smoke: starts the server from the installed package (--no-open),
 *      parses the tokenized loopback URL it prints, then asserts:
 *        - GET /                    → 200 HTML served from the bundled dist/web
 *        - GET /api/health + token  → { ok:true, version }
 *        - GET /api/search + token  → has `available` (degrades cleanly if the
 *                                     native module is absent — no crash)
 *        - GET /api/pty/status+token→ has `available` (same)
 *      then kills the server cleanly.
 *   6. cleans up every temp dir and the .tgz.
 *
 * Exit 0 on success; non-zero with a clear message on any failure. No new deps
 * (node builtins + npm only). Does NOT publish.
 */

/* global process, fetch, URL, URLSearchParams, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Temp paths to remove on exit, whether we pass or fail. */
const cleanups = [];
function cleanup() {
  for (const p of cleanups) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // best effort — a leaked temp file must never mask the real result
    }
  }
}

function log(msg) {
  process.stdout.write(`[e2e] ${msg}\n`);
}

function fail(msg) {
  throw new Error(msg);
}

/** Run a command to completion; throw with captured output on non-zero exit. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) fail(`${cmd} ${args.join(' ')} failed to spawn: ${res.error.message}`);
  if (!opts.allowNonZero && res.status !== 0) {
    fail(
      `${cmd} ${args.join(' ')} exited ${res.status}\n` +
        `--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
    );
  }
  return res;
}

/** Poll a URL until it responds or the deadline passes. */
async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`GET ${url} did not return JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

async function main() {
  // 1. Fresh build.
  log('building fresh dist (npm run build)...');
  run(NPM, ['run', 'build']);
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'cli', 'index.js')))
    fail('build did not produce dist/cli/index.js');
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'web', 'index.html')))
    fail('build did not produce dist/web/index.html (bundled web UI)');

  // 2. Pack the publish tarball into a scratch dir.
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-pack-'));
  cleanups.push(packDir);
  log('packing tarball (npm pack)...');
  const packRes = run(NPM, ['pack', '--json', '--pack-destination', packDir]);
  let packMetadata;
  try {
    const parsed = JSON.parse(packRes.stdout);
    packMetadata = parsed[0];
  } catch {
    fail(`could not parse \`npm pack --json\` output:\n${packRes.stdout}`);
  }
  const tgzName = packMetadata?.filename;
  if (!tgzName) fail('npm pack did not report a tarball filename');
  // npm may report a scoped filename with a leading path separator; basename it.
  const tgzPath = path.join(packDir, path.basename(tgzName));
  if (!fs.existsSync(tgzPath)) fail(`packed tarball not found at ${tgzPath}`);
  log(`packed ${path.basename(tgzPath)}`);

  // Assert the publish boundary from npm's own tarball manifest. Keep these
  // checks structural so hashed Vite assets and harmless size changes do not
  // make the release gate brittle.
  const packedFiles = (packMetadata.files ?? []).map((file) => file.path);
  const requiredFiles = [
    'package.json',
    'LICENSE',
    'README.md',
    'dist/cli/index.js',
    'dist/core/index.js',
    'dist/server/index.js',
    'dist/web/index.html',
  ];
  for (const required of requiredFiles) {
    if (!packedFiles.includes(required)) fail(`tarball is missing required file: ${required}`);
  }
  const forbidden = packedFiles.filter((file) => {
    const basename = path.posix.basename(file);
    return (
      /(^|\/)(src|test|tests|fixtures|node_modules)(\/|$)/.test(file) ||
      /(?:\.map|\.ts|\.tsx|\.pem|\.key)$/.test(file) ||
      /^\.env(?:\.|$)/.test(basename) ||
      ['.npmrc', '.pypirc', 'credentials'].includes(basename)
    );
  });
  if (forbidden.length > 0) fail(`tarball contains forbidden files: ${forbidden.join(', ')}`);

  const webHtml = fs.readFileSync(path.join(REPO_ROOT, 'dist', 'web', 'index.html'), 'utf8');
  const referencedAssets = [...webHtml.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(
    (match) => `dist/web${match[1]}`,
  );
  if (referencedAssets.length === 0) fail('dist/web/index.html references no bundled web assets');
  // Follow CSS url(...) references too, so fonts/images cannot silently be
  // omitted while the entry stylesheet remains present.
  for (let i = 0; i < referencedAssets.length; i += 1) {
    const asset = referencedAssets[i];
    if (!packedFiles.includes(asset))
      fail(`web UI references asset missing from tarball: ${asset}`);
    if (asset.endsWith('.css')) {
      const css = fs.readFileSync(path.join(REPO_ROOT, asset), 'utf8');
      for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const reference = match[1];
        if (/^(?:data:|https?:|#)/.test(reference)) continue;
        const resolved = reference.startsWith('/')
          ? path.posix.normalize(`dist/web${reference}`)
          : path.posix.normalize(path.posix.join(path.posix.dirname(asset), reference));
        if (!referencedAssets.includes(resolved)) referencedAssets.push(resolved);
      }
    }
  }
  log(`tarball contract OK (${packedFiles.length} files; ${referencedAssets.length} web assets)`);

  // 3. Clean-room install into a throwaway consumer package.
  const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-consumer-'));
  cleanups.push(consumerDir);
  log('creating clean consumer package + installing tarball with optional deps omitted...');
  run(NPM, ['init', '-y'], { cwd: consumerDir });
  // A real `npm install <tgz>` with optional dependencies forcibly absent.
  const installRes = run(NPM, ['install', tgzPath, '--omit=optional', '--no-audit', '--no-fund'], {
    cwd: consumerDir,
    allowNonZero: true,
  });
  if (installRes.status !== 0) {
    fail(
      `\`npm install <tgz>\` exited ${installRes.status} — the core install must succeed even ` +
        `when optional native deps fail. This is a RELEASE BLOCKER.\n` +
        `--- stdout ---\n${installRes.stdout}\n--- stderr ---\n${installRes.stderr}`,
    );
  }
  const pkgDir = path.join(consumerDir, 'node_modules', 'agentconfiging');
  const installedCli = path.join(pkgDir, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(installedCli))
    fail(`installed package is missing dist/cli/index.js at ${installedCli} — tarball incomplete`);
  if (!fs.existsSync(path.join(pkgDir, 'dist', 'web', 'index.html')))
    fail(
      'installed package is missing dist/web/index.html — the web UI did not ship in the tarball',
    );
  const binLink = path.join(consumerDir, 'node_modules', '.bin', 'agentconfiging');
  if (!fs.existsSync(binLink)) fail('npm did not link the `agentconfiging` bin');
  for (const native of ['better-sqlite3', 'node-pty']) {
    if (fs.existsSync(path.join(pkgDir, '..', native))) {
      fail(`npm --omit=optional unexpectedly installed ${native}`);
    }
  }
  log('install OK (exit 0); optional native dependencies are proven absent');

  // The registry seed is bundled into dist/core rather than shipped as a
  // separate JSON file. Exercise the installed public API offline to prove the
  // seed survived packaging and remains nonempty and valid.
  const installedCore = await import(pathToFileURL(path.join(pkgDir, 'dist', 'core', 'index.js')));
  const seed = installedCore.loadSeed();
  if (seed.issues.length !== 0 || seed.index.entries.length === 0) {
    fail(`installed offline registry seed is invalid or empty: ${JSON.stringify(seed.issues)}`);
  }
  log(`offline registry seed OK (${seed.index.entries.length} entries)`);

  // A tiny repo fixture with a CLAUDE.md so `report` has something to detect.
  const repoFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-repo-'));
  cleanups.push(repoFixture);
  fs.writeFileSync(
    path.join(repoFixture, 'CLAUDE.md'),
    '# Project Instructions\n\nA tiny repo used by the e2e packaging smoke test.\n',
  );

  // Isolate any state the CLI persists (logs / workspace.json) into temp, and
  // point HOME at temp so the server never scans or writes the real home dir.
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-state-'));
  cleanups.push(stateHome);
  const isolatedEnv = {
    HOME: stateHome,
    USERPROFILE: stateHome,
    XDG_STATE_HOME: path.join(stateHome, 'xdg-state'),
    AGENTCONFIGING_LOG_DIR: path.join(stateHome, 'logs'),
    AGENTCONFIGING_STATE_DIR: path.join(stateHome, 'agentconfiging'),
  };

  // 4. Run the installed bin: `agentconfiging report <fixture>`.
  log('running installed bin: agentconfiging report <fixture>...');
  const reportRes = spawnSync(process.execPath, [installedCli, 'report', repoFixture], {
    cwd: repoFixture,
    encoding: 'utf8',
    env: { ...process.env, ...isolatedEnv },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (reportRes.error) fail(`report failed to spawn: ${reportRes.error.message}`);
  if (![0, 1, 2].includes(reportRes.status))
    fail(`report exited ${reportRes.status} (expected severity code 0/1/2)\n${reportRes.stderr}`);
  let report;
  try {
    report = JSON.parse(reportRes.stdout);
  } catch {
    fail(`report stdout was not a single JSON document:\n${reportRes.stdout.slice(0, 500)}`);
  }
  if (typeof report.version !== 'string') fail('report JSON missing string `version`');
  if (!Array.isArray(report.findings)) fail('report JSON missing `findings` array');
  if (!Array.isArray(report.agents)) fail('report JSON missing `agents` array');
  log(
    `report OK (exit ${reportRes.status}): version=${report.version}, ` +
      `agents=${report.agents.length}, findings=${report.findings.length}`,
  );

  // 5. LAUNCH smoke — start the server from the installed package (--no-open).
  log('launching server from installed package (--no-open)...');
  const server = spawn(process.execPath, [installedCli, '--no-open'], {
    cwd: repoFixture,
    env: { ...process.env, ...isolatedEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const launchUrl = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      reject(
        new Error(`server did not print a launch URL within 30s\nstdout:\n${out}\nstderr:\n${err}`),
      );
    }, 30_000);
    const scan = () => {
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/#token=\S+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    server.stdout.on('data', (d) => {
      out += d;
      scan();
    });
    server.stderr.on('data', (d) => {
      err += d;
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `server exited early (code ${code}) before binding\nstdout:\n${out}\nstderr:\n${err}`,
        ),
      );
    });
  });

  try {
    const u = new URL(launchUrl);
    const origin = `${u.protocol}//${u.host}`;
    const token = new URLSearchParams(u.hash.slice(1)).get('token');
    if (!token) fail(`launch URL had no token fragment: ${launchUrl}`);
    log(`server bound at ${origin} (loopback + tokenized URL)`);

    // GET / → 200 HTML from the bundled web UI (served without a token).
    const rootRes = await fetch(`${origin}/`);
    const rootHtml = await rootRes.text();
    if (rootRes.status !== 200) fail(`GET / returned ${rootRes.status}, expected 200`);
    const ctype = rootRes.headers.get('content-type') ?? '';
    if (!ctype.includes('text/html')) fail(`GET / content-type was "${ctype}", expected text/html`);
    if (!rootHtml.includes('<div id="root">'))
      fail('GET / did not serve the bundled web UI shell (missing #root)');
    log(`GET / → 200 ${ctype.split(';')[0]} (bundled web UI)`);

    // GET /api/health + token → { ok:true, version }.
    const health = await fetchJson(`${origin}/api/health`, token);
    if (health.status !== 200) fail(`/api/health returned ${health.status}, expected 200`);
    if (health.body?.ok !== true)
      fail(`/api/health body not { ok:true }: ${JSON.stringify(health.body)}`);
    if (typeof health.body?.version !== 'string') fail('/api/health missing string version');
    log(`GET /api/health → { ok:true, version:${health.body.version} }`);

    // Optional-native degradation proof: these must answer (200) with an
    // `available` flag whether or not the native module built — never crash.
    const search = await fetchJson(`${origin}/api/search?q=smoke`, token);
    if (search.status !== 200) fail(`/api/search returned ${search.status}, expected 200`);
    if (typeof search.body?.available !== 'boolean')
      fail(`/api/search missing boolean available: ${JSON.stringify(search.body)}`);
    if (search.body.available !== false)
      fail('/api/search must report available=false when better-sqlite3 is omitted');
    log(`GET /api/search → available=${search.body.available} (better-sqlite3 optional)`);

    const pty = await fetchJson(`${origin}/api/pty/status`, token);
    if (pty.status !== 200) fail(`/api/pty/status returned ${pty.status}, expected 200`);
    if (typeof pty.body?.available !== 'boolean')
      fail(`/api/pty/status missing boolean available: ${JSON.stringify(pty.body)}`);
    if (pty.body.available !== false)
      fail('/api/pty/status must report available=false when node-pty is omitted');
    log(`GET /api/pty/status → available=${pty.body.available} (node-pty optional)`);
  } finally {
    // Kill the server cleanly.
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    const killed = await Promise.race([
      exited.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5_000)),
    ]);
    if (!killed) {
      server.kill('SIGKILL');
      await exited;
    }
    log('server killed cleanly');
  }

  log('SMOKE TEST PASSED — npx agentconfiging works from the packed tarball.');
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`\n[e2e] FAILED: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });
