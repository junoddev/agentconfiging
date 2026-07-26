/**
 * Discovery marker tables — the cheap, name-only fingerprints used by the
 * recursive project walker (SPEC §4.2).
 *
 * Marker-source decision: these rows mirror each detector's MATCH TRIGGERS
 * (the `matches()` predicates in src/core/detectors/*.ts), written out
 * declaratively here. Neither alternative source fit:
 *
 *   - The detector modules carry their signals as code (predicates over a
 *     Manifest), not as data — there is no existing marker-path data on
 *     them to re-export, so adding a `markerPaths` field would have meant
 *     authoring a second, parallel signal list inside every detector.
 *   - The scanner's KNOWN_FILES/KNOWN_DIRS tables are the wrong shape twice
 *     over: they over-offer (COPILOT.md, .continuerules and .aider/ appear
 *     there but are NOT match triggers for any detector — a hit on them
 *     alone would offer a directory the engine then rejects) and they
 *     under-offer (opencode.json, codex.toml and the .github copilot paths
 *     ARE match triggers but absent — the scanner collects those via other
 *     include rules). They also carry no runtime attribution, which
 *     discovery hits need for their `runtimes` field.
 *
 * Drift guards (markers.test.ts), both polarities:
 *   - Forward: every row below is synthesized into a minimal project-scope
 *     Manifest and the attributed detector must match it — a detector
 *     signal change that invalidates a row turns the suite red.
 *   - Reverse: every first-class entry in src/core/runtimes/ RUNTIME_FORMATS
 *     must have all of its `detectionMarkers` representable here (file
 *     marker in FILE_MARKERS, dir-prefix marker in DIR_MARKERS or the
 *     .github probe) under the same runtime id, and every registered
 *     detector id must appear in at least one row. RUNTIME_FORMATS'
 *     detectionMarkers are themselves cross-checked against detector
 *     matches() by runtimes.test.ts, so a new detector or a new trigger
 *     fails that table's tests AND this reverse guard — the
 *     silently-undiscovered-projects polarity is covered.
 *
 * Known benign over-offer: a dir marker matches on the entry NAME alone, so
 * an EMPTY .claude/ (etc.) yields a discovery hit even though the detector,
 * which requires files under the prefix, would rate it absent when the
 * instance is opened. Accepted: discovery is a cheap offer list, and the
 * alternative (a readdir per marker dir) buys little.
 *
 * Values are detector ids (= DetectedAgent.kind), keys are directory-entry
 * NAMES — discovery matches on names only, never file contents.
 */

/** Root-level file entry name → runtime id. */
export const FILE_MARKERS: ReadonlyMap<string, string> = new Map([
  ['CLAUDE.md', 'claude-code'],
  ['AGENTS.md', 'codex'],
  ['codex.toml', 'codex'],
  ['GEMINI.md', 'gemini-cli'],
  ['.cursorrules', 'cursor'],
  ['.aider.conf.yml', 'aider'],
  ['.aiderignore', 'aider'],
  ['opencode.json', 'opencode'],
]);

/**
 * Root-level directory entry name → runtime id. Marker dirs are recorded
 * on the containing root and never recursed into — their contents are
 * runtime configuration, not nested projects.
 */
export const DIR_MARKERS: ReadonlyMap<string, string> = new Map([
  ['.claude', 'claude-code'],
  ['.codex', 'codex'],
  ['.cursor', 'cursor'],
  ['.continue', 'continue'],
  ['.gemini', 'gemini-cli'],
  ['.opencode', 'opencode'],
]);

/**
 * Copilot's two match triggers live one level down, inside .github/ —
 * the walker shallow-probes a `.github` entry (one readdir, names only)
 * instead of treating it as a marker dir itself.
 */
export const GITHUB_DIR = '.github';
export const GITHUB_COPILOT_FILE = 'copilot-instructions.md';
export const GITHUB_COPILOT_DIR = 'copilot';
export const COPILOT_RUNTIME = 'copilot';
