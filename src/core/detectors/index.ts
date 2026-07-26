/**
 * Detector barrel — auto-discovery wiring (SPEC §4.1).
 *
 * Each detector module self-registers on import (see registry.ts for the
 * full rationale). The side-effect imports below are the ONLY wiring a
 * detector needs beyond its own file; nothing else in the codebase lists
 * detectors. `registry.test.ts` fs-reads this directory and fails if any
 * detector module file is missing from the registry — i.e. if you add
 * `foo.ts` and forget its import line here, the test suite goes red.
 */

import './aider.js';
import './claude-code.js';
import './codex.js';
import './continue.js';
import './copilot.js';
import './cursor.js';
import './gemini-cli.js';
import './opencode.js';

export { allDetectors, detect, registerDetector } from './registry.js';
export type { Confidence, DetectedAgent, Detector } from './types.js';
