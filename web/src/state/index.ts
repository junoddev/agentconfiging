/** Public surface of the app-state layer (the seam E4 pages plug into). */
export {
  AppStateProvider,
  useAppState,
  useGlobalConfig,
  useReport,
  type AppStateDeps,
  type AppStateProviderProps,
  type AppStateValue,
} from './AppStateContext.js';
export {
  activeAgent,
  appReducer,
  currentInstance,
  initialAppState,
  type AppAction,
  type AppError,
  type AppErrorKind,
  type AppState,
} from './appState.js';
export {
  agentKindsForFile,
  availableAgents,
  displayNameForKind,
  isClaudeKind,
  otherAgentKinds,
  resolveActiveAgent,
  scopeReport,
  scopedAgents,
  sectionApplies,
  type ConfigSection,
} from './agentScope.js';
