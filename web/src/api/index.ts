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
  Report,
  ReportFinding,
  Severity,
  WsMessage,
} from './types.js';
