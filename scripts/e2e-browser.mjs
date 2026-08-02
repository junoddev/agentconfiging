#!/usr/bin/env node
/**
 * Real-browser e2e gate for the built app.
 *
 * Builds dist, launches the real CLI/server over a temp project and temp HOME,
 * then drives headless Chrome via the Chrome DevTools Protocol. This catches
 * browser-only failures that curl/unit tests miss.
 */

/* global process, URL, URLSearchParams, setTimeout, clearTimeout, Buffer */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CDP_TIMEOUT_MS = 12_000;

const cleanups = [];

function log(msg) {
  process.stdout.write(`[e2e:browser] ${msg}\n`);
}

function fail(msg) {
  throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanup() {
  for (const p of cleanups.reverse()) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // best effort: leaked temp paths must not mask the test failure
    }
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) fail(`${cmd} ${args.join(' ')} failed to spawn: ${res.error.message}`);
  if (res.status !== 0) {
    fail(
      `${cmd} ${args.join(' ')} exited ${res.status}\n` +
        `--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
    );
  }
  return res;
}

export function parseLaunchUrl(text) {
  const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[^\s]+/);
  return match?.[0];
}

export function buildRoutedLaunchUrl(launchUrl, route) {
  const parsed = new URL(launchUrl);
  const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
  if (!token) fail(`launch URL had no token fragment: ${launchUrl}`);
  const cleanRoute = route.startsWith('/') ? route : `/${route}`;
  return `${parsed.origin}/#token=${encodeURIComponent(token)}&${cleanRoute}`;
}

export function apiPathFromRequestUrl(requestUrl) {
  const parsed = new URL(requestUrl);
  return parsed.pathname.startsWith('/api') ? parsed.pathname : undefined;
}

export function assertObservedApiTraffic(urls, requiredPaths) {
  const seen = new Set(
    urls.map((u) => apiPathFromRequestUrl(u)).filter((u) => typeof u === 'string'),
  );
  const missing = requiredPaths.filter((p) => !seen.has(p));
  if (missing.length > 0) {
    fail(
      `CDP Network.requestWillBeSent did not observe required API traffic: ${missing.join(', ')}`,
    );
  }
}

export function assertRenderedText(text, required) {
  const missing = required.filter((needle) => !text.includes(needle));
  if (missing.length > 0) fail(`rendered page text missing: ${missing.join(', ')}`);
}

function fixtureSettings(projectCommand, globalCommand) {
  return {
    project: JSON.stringify(
      {
        model: 'claude-sonnet-4-5',
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: projectCommand }] }],
        },
      },
      null,
      2,
    ),
    global: JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [{ type: 'command', command: globalCommand }],
            },
          ],
        },
      },
      null,
      2,
    ),
  };
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-browser-'));
  cleanups.push(base);

  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Project Instructions\n\n- Keep browser e2e fixtures deterministic.\n',
  );

  const settings = fixtureSettings(
    '.claude/hooks/e2e-existing-project.sh',
    '.claude/hooks/e2e-existing-global.sh',
  );
  fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${settings.project}\n`);
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), `${settings.global}\n`);

  const now = Date.now();
  const sessionDir = path.join(home, '.claude', 'projects', '-tmp-agentconfiging-browser-repo');
  const sessionFile = path.join(sessionDir, 'browser-session.jsonl');
  writeJsonl(sessionFile, [
    { type: 'summary', summary: 'Browser e2e seeded session' },
    {
      type: 'user',
      sessionId: 'browser-session',
      timestamp: new Date(now - 120_000).toISOString(),
      cwd: repo,
      message: { role: 'user', content: 'open dashboard' },
    },
    {
      type: 'assistant',
      sessionId: 'browser-session',
      timestamp: new Date(now - 60_000).toISOString(),
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'dashboard rendered' }],
        usage: { input_tokens: 320, output_tokens: 40 },
      },
    },
  ]);
  fs.writeFileSync(
    path.join(home, '.claude', 'history.jsonl'),
    JSON.stringify({ display: 'dashboard prompt', timestamp: now - 120_000, project: repo }) + '\n',
  );

  return {
    base,
    repo,
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      XDG_STATE_HOME: path.join(home, 'xdg-state'),
      AGENTCONFIGING_LOG_DIR: path.join(home, 'logs'),
      AGENTCONFIGING_STATE_DIR: path.join(home, 'agentconfiging'),
    },
  };
}

async function waitForLaunchUrl(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      reject(new Error(`server did not print a launch URL within ${timeoutMs}ms\n${out}\n${err}`));
    }, timeoutMs);
    const scan = () => {
      const url = parseLaunchUrl(out);
      if (!url) return;
      clearTimeout(timer);
      resolve(url);
    };
    child.stdout.on('data', (chunk) => {
      out += chunk;
      scan();
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code})\nstdout:\n${out}\nstderr:\n${err}`));
    });
  });
}

async function stopChild(child, name) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const done = await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)]);
  if (!done) {
    child.kill('SIGKILL');
    await exited;
  }
  log(`${name} stopped`);
}

export function findExecutableOnPath(names, envPath = process.env.PATH) {
  if (!envPath) return undefined;
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = path.join(dir, `${name}${extension}`);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {
          // Keep searching PATH.
        }
      }
    }
  }
  return undefined;
}

function chromeCandidates() {
  const envPath = process.env.CHROME_PATH ?? process.env.CHROMIUM_PATH;
  const pathChrome = findExecutableOnPath([
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'chrome',
  ]);
  const candidates = [
    envPath,
    pathChrome,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  return candidates.filter((candidate) => candidate && fs.existsSync(candidate));
}

function resolveChromePath() {
  const [first] = chromeCandidates();
  if (!first) {
    fail(
      'No Chrome/Chromium binary found. Install Google Chrome/Chromium or set CHROME_PATH to run npm run e2e:browser.',
    );
  }
  return first;
}

export function waitForChromeCdp(chrome, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => {
      reject(new Error(`Chrome did not expose a CDP URL within ${timeoutMs}ms\n${text}`));
    }, timeoutMs);
    const scan = (chunk) => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    chrome.stdout.on('data', scan);
    chrome.stderr.on('data', scan);
    chrome.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Chrome failed to spawn: ${err.message}\n${text}`));
    });
    chrome.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Chrome exited before CDP was ready (code=${String(code)}, signal=${String(
            signal,
          )})\n${text}`,
        ),
      );
    });
  });
}

function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-chrome-'));
  cleanups.push(userDataDir);
  const chrome = spawn(
    resolveChromePath(),
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const wsUrl = waitForChromeCdp(chrome);

  return { chrome, wsUrl };
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

class CdpConnection {
  #socket;
  #buffer = Buffer.alloc(0);
  #ready = false;
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(wsUrl);
      const socket = net.connect(Number(parsed.port), parsed.hostname);
      const cdp = new CdpConnection(socket);
      const key = randomBytes(16).toString('base64');
      const expectedAccept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
      const pathWithSearch = `${parsed.pathname}${parsed.search}`;
      const timer = setTimeout(() => reject(new Error('CDP websocket handshake timed out')), 5_000);

      socket.once('connect', () => {
        socket.write(
          `GET ${pathWithSearch} HTTP/1.1\r\n` +
            `Host: ${parsed.host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      socket.on('data', (chunk) => {
        try {
          cdp.#receive(chunk, expectedAccept, () => {
            clearTimeout(timer);
            resolve(cdp);
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
          socket.destroy();
        }
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('close', () => {
        for (const pending of cdp.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('CDP socket closed'));
        }
        cdp.#pending.clear();
      });
    });
  }

  constructor(socket) {
    this.#socket = socket;
  }

  on(method, handler) {
    const list = this.#handlers.get(method) ?? [];
    list.push(handler);
    this.#handlers.set(method, list);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    this.#sendFrame(1, Buffer.from(JSON.stringify(payload), 'utf8'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, CDP_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer, method });
    });
  }

  close() {
    if (!this.#socket.destroyed) this.#socket.end();
  }

  #receive(chunk, expectedAccept, onReady) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (!this.#ready) {
      const end = this.#buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const header = this.#buffer.slice(0, end).toString('utf8');
      if (!/^HTTP\/1\.1 101\b/i.test(header)) fail(`CDP handshake failed:\n${header}`);
      const accept = /sec-websocket-accept:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim();
      if (accept !== expectedAccept) fail('CDP websocket accept header mismatch');
      this.#buffer = this.#buffer.slice(end + 4);
      this.#ready = true;
      onReady();
    }
    this.#drainFrames();
  }

  #drainFrames() {
    for (;;) {
      const frame = this.#readFrame();
      if (!frame) return;
      if (frame.opcode === 1) this.#handleMessage(frame.payload.toString('utf8'));
      else if (frame.opcode === 8) this.#socket.end();
      else if (frame.opcode === 9) this.#sendFrame(10, frame.payload);
    }
  }

  #readFrame() {
    if (this.#buffer.length < 2) return undefined;
    const b0 = this.#buffer[0];
    const b1 = this.#buffer[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (this.#buffer.length < offset + 2) return undefined;
      len = this.#buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (this.#buffer.length < offset + 8) return undefined;
      const high = this.#buffer.readUInt32BE(offset);
      const low = this.#buffer.readUInt32BE(offset + 4);
      if (high !== 0) fail('CDP frame too large');
      len = low;
      offset += 8;
    }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (this.#buffer.length < offset + len) return undefined;
    let payload = this.#buffer.slice(offset, offset + len);
    if (masked) {
      const mask = this.#buffer.slice(maskOffset, maskOffset + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    this.#buffer = this.#buffer.slice(offset + len);
    return { opcode, payload };
  }

  #sendFrame(opcode, payload) {
    const mask = randomBytes(4);
    const len = payload.length;
    const headerLength = len < 126 ? 2 : len < 65536 ? 4 : 10;
    const header = Buffer.alloc(headerLength);
    header[0] = 0x80 | opcode;
    if (len < 126) {
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.#socket.write(Buffer.concat([header, mask, masked]));
  }

  #handleMessage(text) {
    const msg = JSON.parse(text);
    if (typeof msg.id === 'number') {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(msg.id);
      if (msg.error)
        pending.reject(new Error(`CDP ${pending.method} failed: ${msg.error.message}`));
      else pending.resolve(msg.result);
      return;
    }
    for (const handler of this.#handlers.get(msg.method) ?? []) handler(msg);
  }
}

class PageSession {
  constructor(cdp, sessionId, browserErrors, apiRequests) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.browserErrors = browserErrors;
    this.apiRequests = apiRequests;
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      fail(`page evaluation failed: ${result.exceptionDetails.text ?? expression}`);
    }
    return result.result?.value;
  }

  assertNoBrowserErrors() {
    if (this.browserErrors.length > 0) {
      fail(`browser console/runtime error(s):\n${this.browserErrors.join('\n')}`);
    }
  }
}

function consoleArgText(arg) {
  if ('value' in arg) return String(arg.value);
  if (typeof arg.description === 'string') return arg.description;
  return arg.type ?? 'unknown';
}

async function createPage(cdp) {
  const browserErrors = [];
  const apiRequests = [];
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const page = new PageSession(cdp, attached.sessionId, browserErrors, apiRequests);

  cdp.on('Runtime.consoleAPICalled', (msg) => {
    if (msg.sessionId !== page.sessionId) return;
    if (msg.params?.type === 'error') {
      const args = (msg.params.args ?? []).map(consoleArgText).join(' ');
      browserErrors.push(args || 'console.error called');
    }
  });
  cdp.on('Runtime.exceptionThrown', (msg) => {
    if (msg.sessionId !== page.sessionId) return;
    browserErrors.push(msg.params?.exceptionDetails?.text ?? 'uncaught exception');
  });
  cdp.on('Network.requestWillBeSent', (msg) => {
    if (msg.sessionId !== page.sessionId) return;
    const url = msg.params?.request?.url;
    if (typeof url === 'string') apiRequests.push(url);
  });

  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Page.enable');
  return page;
}

async function waitFor(page, label, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    page.assertNoBrowserErrors();
    last = await predicate();
    if (last) return last;
    await sleep(100);
  }
  fail(`timed out waiting for ${label}${last ? ` (${last})` : ''}`);
}

async function bodyText(page) {
  return String(
    await page.evaluate('document.body && document.body.innerText ? document.body.innerText : ""'),
  );
}

async function waitForText(page, text, timeoutMs = 12_000) {
  await waitFor(
    page,
    `rendered text "${text}"`,
    async () => {
      const current = await bodyText(page);
      return current.includes(text);
    },
    timeoutMs,
  );
}

async function waitForRenderedDiff(page, label, expectedLine, timeoutMs = 12_000) {
  await waitFor(
    page,
    `rendered diff for ${label} containing ${expectedLine}`,
    () =>
      page.evaluate(`(() => {
        const panels = Array.from(document.querySelectorAll('.diff'));
        return panels.some((panel) => {
          const renderedLabel = panel.querySelector('.diff__label')?.textContent || '';
          const header = panel.querySelector('.diff__header')?.textContent || '';
          const lines = Array.from(panel.querySelectorAll('.diff__line'));
          return renderedLabel.includes(${JSON.stringify(label)})
            && header.trim().startsWith('@@')
            && lines.some((line) => (line.textContent || '').includes(${JSON.stringify(expectedLine)}));
        });
      })()`),
    timeoutMs,
  );
}

async function clickButton(page, label, mode = 'exact') {
  const clicked = await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const mode = ${JSON.stringify(mode)};
    const candidates = Array.from(document.querySelectorAll('button, a'));
    const match = candidates.find((el) => {
      const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return mode === 'prefix' ? text.startsWith(label) : text === label;
    });
    if (!match) return false;
    match.click();
    return true;
  })()`);
  if (!clicked) fail(`could not click control: ${label}`);
}

async function setHookCommand(page, value) {
  const ok = await page.evaluate(`(() => {
    const el = document.querySelector('#hook-command');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(
      value,
    )} }));
    return true;
  })()`);
  if (!ok) fail('could not fill hook command field');
}

async function selectHookTarget(page, matcher) {
  const result = await page.evaluate(`(() => {
    const select = document.querySelector('#hook-target');
    if (!select) return 'missing';
    const matcher = ${JSON.stringify(matcher)};
    const option = Array.from(select.options).find((o) => o.value === matcher)
      || Array.from(select.options).find((o) => (o.textContent || '').includes(matcher) || o.value.includes(matcher));
    if (!option) return 'no-option';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  if (result !== 'ok') fail(`could not select hook target ${matcher}: ${result}`);
}

async function navigate(page, url) {
  await page.send('Page.navigate', { url });
}

async function setHash(page, route) {
  await page.evaluate(`location.hash = ${JSON.stringify(route)}; true`);
}

async function projectWriteJourney(page, fixture) {
  const command = '.claude/hooks/e2e-browser-project.sh';
  await setHash(page, '#/hooks');
  await waitForText(page, 'Hooks');
  await waitForText(page, '.claude/hooks/e2e-existing-global.sh');
  assertRenderedText(await bodyText(page), ['.claude/hooks/e2e-existing-global.sh']);
  await waitFor(page, 'global hook row with GLOBAL source badge', () =>
    page.evaluate(`(() => {
      const hookPath = '.claude/hooks/e2e-existing-global.sh';
      return Array.from(document.querySelectorAll('.list-row')).some((row) => {
        const rowText = (row.textContent || '').replace(/\\s+/g, ' ').trim();
        const badges = Array.from(row.querySelectorAll('.source-badge'));
        return rowText.includes(hookPath)
          && badges.some((badge) => (badge.textContent || '').replace(/\\s+/g, ' ').trim().includes('GLOBAL'));
      });
    })()`),
  );

  await clickButton(page, 'Add hook');
  await waitForText(page, 'Add hook');
  await selectHookTarget(page, '.claude/settings.json');
  await setHookCommand(page, command);
  await clickButton(page, 'Preview change');
  await waitForRenderedDiff(page, '.claude/settings.json', command);
  await waitForText(page, 'Commit');
  await clickButton(page, 'Commit', 'prefix');
  await waitFor(page, 'project hook committed to disk', async () =>
    fs.readFileSync(path.join(fixture.repo, '.claude', 'settings.json'), 'utf8').includes(command),
  );
}

async function globalWarningJourney(page, fixture) {
  const command = '.claude/hooks/e2e-browser-global.sh';
  await clickButton(page, 'Add hook');
  await waitForText(page, 'Add hook');
  await selectHookTarget(page, 'GLOBAL');
  await setHookCommand(page, command);
  await clickButton(page, 'Preview change');
  await waitForText(page, 'GLOBAL SCOPE');
  await waitForText(page, 'AFFECTS ALL PROJECTS');
  await waitForText(page, 'Commit');
  assertRenderedText(await bodyText(page), ['GLOBAL SCOPE', 'AFFECTS ALL PROJECTS', command]);
  await clickButton(page, 'Commit', 'prefix');
  await waitFor(page, 'global hook committed to disk', async () =>
    fs.readFileSync(path.join(fixture.home, '.claude', 'settings.json'), 'utf8').includes(command),
  );
}

async function main() {
  log('building real dist artifact...');
  run(NPM, ['run', 'build']);
  const builtCli = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
  const builtWeb = path.join(REPO_ROOT, 'dist', 'web', 'index.html');
  if (!fs.existsSync(builtCli)) fail('build did not produce dist/cli/index.js');
  if (!fs.existsSync(builtWeb)) fail('build did not produce dist/web/index.html');

  const fixture = makeFixture();
  log(`fixture repo: ${fixture.repo}`);

  const server = spawn(process.execPath, [builtCli, '--no-open'], {
    cwd: fixture.repo,
    env: { ...process.env, ...fixture.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let chrome;
  let cdp;
  try {
    const launchUrl = await waitForLaunchUrl(server);
    log('server launched with tokenized loopback URL');

    const routedDashboardUrl = buildRoutedLaunchUrl(launchUrl, '/dashboard');
    chrome = launchChrome();
    const wsUrl = await chrome.wsUrl;
    log('headless Chrome launched over CDP');
    cdp = await CdpConnection.connect(wsUrl);
    const version = await httpGetJson(
      wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '/json/version'),
    );
    if (!String(version.Browser ?? '').includes('Chrome')) {
      fail(`CDP endpoint is not Chrome: ${JSON.stringify(version)}`);
    }
    const page = await createPage(cdp);

    await navigate(page, routedDashboardUrl);
    await waitForText(page, 'Dashboard');
    await waitForText(page, 'Sessions');
    await waitForText(page, 'Messages');
    await waitForText(page, 'Achievements');
    const dashboardText = await bodyText(page);
    if (dashboardText.includes('This machine has no session history yet')) {
      fail('dashboard rendered the empty-history state instead of seeded data');
    }
    const dashboardTileValues = await page.evaluate(`(() => {
      const values = {};
      for (const tile of document.querySelectorAll('.tile')) {
        const label = tile.querySelector('.t-label')?.textContent?.trim();
        if (label === 'Sessions' || label === 'Messages') {
          values[label] = tile.querySelector('.t-num')?.textContent?.trim();
        }
      }
      return values;
    })()`);
    for (const label of ['Sessions', 'Messages']) {
      const rendered = dashboardTileValues[label];
      const value = Number(String(rendered ?? '').replaceAll(',', ''));
      if (!rendered || !Number.isFinite(value) || value <= 0) {
        fail(`dashboard ${label} tile did not render a positive numeric value: ${rendered}`);
      }
    }
    log('dashboard rendered seeded session analytics');

    await projectWriteJourney(page, fixture);
    log('project hook write previewed and committed');

    await globalWarningJourney(page, fixture);
    log('global hook write showed all-projects warning and committed');

    assertObservedApiTraffic(page.apiRequests, [
      '/api/instances',
      '/api/report',
      '/api/stats',
      '/api/file',
      '/api/write',
      '/api/hooks/edit',
    ]);
    page.assertNoBrowserErrors();
    log('observed required CDP network traffic and no browser console errors');
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => undefined);
      cdp.close();
    }
    if (chrome) await stopChild(chrome.chrome, 'Chrome').catch(() => undefined);
    await stopChild(server, 'server').catch(() => undefined);
  }

  log('BROWSER E2E PASSED');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => {
      cleanup();
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`\n[e2e:browser] FAILED: ${err.message}\n`);
      cleanup();
      process.exit(1);
    });
}
