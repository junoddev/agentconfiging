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
  appReducer,
  currentInstance,
  initialAppState,
  type AppAction,
  type AppError,
  type AppErrorKind,
  type AppState,
} from './appState.js';
