/**
 * Core barrel — the complete public surface of src/core (SPEC §4.1).
 *
 * Each sub-barrel curates its own exports; this file just aggregates them.
 * Everything here is pure except the designated I/O modules: scanner
 * (fs walk → Manifest), discovery (fs walk → project hits), and global
 * (scanner composition with a temp-home isolation fallback).
 */

export * from './findings.js';
export * from './manifest.js';
export * from './scanner.js';
export * from './global.js';
export * from './report.js';
export * from './context-health/index.js';
export * from './detectors/index.js';
export * from './analyzers/index.js';
export * from './parsers/index.js';
export * from './history/index.js';
export * from './stats/index.js';
export * from './analytics/index.js';
export * from './redact/index.js';
export * from './discovery/index.js';
export * from './runtimes/index.js';
export * from './registry/index.js';
export * from './pipeline/index.js';
