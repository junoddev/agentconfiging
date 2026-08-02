import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  apiPathFromRequestUrl,
  assertObservedApiTraffic,
  assertRenderedText,
  buildRoutedLaunchUrl,
  findExecutableOnPath,
  parseLaunchUrl,
  waitForChromeCdp,
} from './e2e-browser.mjs';

describe('e2e-browser helpers', () => {
  it('parses the tokenized loopback launch URL from CLI output', () => {
    expect(parseLaunchUrl('INFO\nSERVER UP · http://127.0.0.1:49152/#token=abc_123\n')).toBe(
      'http://127.0.0.1:49152/#token=abc_123',
    );
    expect(parseLaunchUrl('no url here')).toBeUndefined();
  });

  it('adds a hash route while preserving the launch token segment', () => {
    expect(buildRoutedLaunchUrl('http://127.0.0.1:1234/#token=a%20b', '/dashboard')).toBe(
      'http://127.0.0.1:1234/#token=a%20b&/dashboard',
    );
  });

  it('normalizes observed request URLs to API paths', () => {
    expect(apiPathFromRequestUrl('http://127.0.0.1:1/api/report?scope=global')).toBe('/api/report');
    expect(apiPathFromRequestUrl('http://127.0.0.1:1/assets/index.js')).toBeUndefined();
  });

  it('asserts required API request paths were observed', () => {
    const urls = ['http://127.0.0.1:1/api/report', 'http://127.0.0.1:1/api/write'];
    expect(() => assertObservedApiTraffic(urls, ['/api/report', '/api/write'])).not.toThrow();
    expect(() => assertObservedApiTraffic(urls, ['/api/stats'])).toThrow(/required API traffic/);
  });

  it('asserts rendered text contains human-visible evidence', () => {
    expect(() => assertRenderedText('Dashboard\nSessions\nMessages', ['Sessions'])).not.toThrow();
    expect(() => assertRenderedText('Dashboard', ['Hooks'])).toThrow(/rendered page text/);
  });

  it('finds a Chrome-compatible executable on PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-path-'));
    const executable = path.join(dir, 'chromium');
    try {
      fs.writeFileSync(executable, '#!/bin/sh\n');
      fs.chmodSync(executable, 0o755);
      expect(findExecutableOnPath(['google-chrome', 'chromium'], dir)).toBe(executable);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves Chrome startup output when CDP readiness fails', async () => {
    const chrome = new EventEmitter();
    chrome.stdout = new PassThrough();
    chrome.stderr = new PassThrough();
    const ready = waitForChromeCdp(chrome, 25);
    chrome.stderr.write('startup diagnostic');
    await expect(ready).rejects.toThrow(/25ms[\s\S]*startup diagnostic/);
  });

  it('reports an early Chrome exit with its startup diagnostics', async () => {
    const chrome = new EventEmitter();
    chrome.stdout = new PassThrough();
    chrome.stderr = new PassThrough();
    const ready = waitForChromeCdp(chrome);
    chrome.stderr.write('profile could not be opened');
    chrome.emit('exit', 1, null);
    await expect(ready).rejects.toThrow(/exited before CDP[\s\S]*profile could not be opened/);
  });

  it('preserves the underlying Chrome spawn error', async () => {
    const chrome = new EventEmitter();
    chrome.stdout = new PassThrough();
    chrome.stderr = new PassThrough();
    const ready = waitForChromeCdp(chrome);
    chrome.emit('error', new Error('EACCES'));
    await expect(ready).rejects.toThrow(/failed to spawn: EACCES/);
  });
});
