export type {
  ContentBlock,
  HistoryAdapter,
  PromptHistory,
  PromptHistoryEntry,
  ReadDiagnostics,
  Runtime,
  Session,
  SessionFileRef,
  SessionMessage,
} from './types.js';
export { RUNTIMES } from './types.js';
export { claudeAdapter, parseClaudeHistory, parseClaudeSession, readSessionCwd } from './claude.js';

import type { HistoryAdapter } from './types.js';
import { claudeAdapter } from './claude.js';

/** All implemented history adapters (claude only, for now). */
export const historyAdapters: readonly HistoryAdapter[] = [claudeAdapter];
