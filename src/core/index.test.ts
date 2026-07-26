/**
 * Core barrel completeness pin. The barrel aggregates 13 sub-barrels via
 * `export *`, and ESM SILENTLY DROPS any name exported by more than one of
 * them (ambiguous re-export). This test guards against that drift: every
 * runtime export of every sub-barrel must be present on the core barrel.
 */

import { describe, expect, it } from 'vitest';
import * as core from './index.js';
import * as findings from './findings.js';
import * as manifest from './manifest.js';
import * as scanner from './scanner.js';
import * as report from './report.js';
import * as detectors from './detectors/index.js';
import * as analyzers from './analyzers/index.js';
import * as parsers from './parsers/index.js';
import * as history from './history/index.js';
import * as stats from './stats/index.js';
import * as redact from './redact/index.js';
import * as discovery from './discovery/index.js';
import * as runtimes from './runtimes/index.js';
import * as registry from './registry/index.js';

const barrels = {
  findings,
  manifest,
  scanner,
  report,
  detectors,
  analyzers,
  parsers,
  history,
  stats,
  redact,
  discovery,
  runtimes,
  registry,
};

describe('core barrel', () => {
  it('re-exports every runtime export of all 13 sub-barrels (no silent ambiguous drops)', () => {
    const names = [...new Set(Object.values(barrels).flatMap((m) => Object.keys(m)))];
    const missing = names.filter((name) => !(name in core));
    expect(missing).toEqual([]);
    // 97 unique runtime names as of this pin; shrinkage means a drop.
    expect(names.length).toBeGreaterThanOrEqual(97);
  });
});
