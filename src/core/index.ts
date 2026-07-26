export { SEVERITIES, slugify, sortFindings } from './findings.js';
export type { Finding, Severity } from './findings.js';
export { parseManifest } from './manifest.js';
export type { Manifest, ManifestFile, ManifestStats, ManifestScope } from './manifest.js';
export {
  KNOWN_FILES,
  KNOWN_DIRS,
  ALLOWED_EXTS,
  SKIP_DIRS,
  GLOBAL_SKIP_DIRS,
  CAPS,
  ScanError,
  scanProject,
  scanGlobal,
} from './scanner.js';
export type { ScanErrorCode } from './scanner.js';
