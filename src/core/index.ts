/**
 * Core barrel — the complete public surface of src/core (SPEC §4.1).
 *
 * Each sub-barrel curates its own exports; this file just aggregates them.
 * Everything here is pure except the two designated I/O modules: scanner
 * (fs walk → Manifest) and discovery (fs walk → project hits).
 */

export * from './findings.js';
export * from './manifest.js';
export * from './scanner.js';
export * from './report.js';
export * from './detectors/index.js';
export * from './analyzers/index.js';
export * from './parsers/index.js';
export * from './history/index.js';
export * from './redact/index.js';
export * from './discovery/index.js';
export * from './runtimes/index.js';
