/** Public surface of the API + data layer. */
export { ApiClient, ApiError, type ApiClientOptions, type ApiErrorKind } from './client.js';
export { bootstrapToken, parseTokenHash, type ParsedToken } from './token.js';
export type {
  Confidence,
  DetectedAgent,
  FileContent,
  FixKind,
  HealthResponse,
  InstanceSummary,
  InstancesResponse,
  ManifestStats,
  RedactionSpan,
  Report,
  ReportFinding,
  Severity,
  StorageCleanupResponse,
  StorageEntry,
  StorageHome,
  StorageReport,
  WsMessage,
} from './types.js';
