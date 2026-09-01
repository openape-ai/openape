export {
  authFileFor,
  DEFAULT_APE_SHELL_PATH,
  DEFAULT_WAIT_TIMEOUT_MS,
  GateConfigError,
  readGateConfig,
  type GateConfig,
} from './config.js'
export {
  decideExec,
  isAlreadyWrapped,
  wrapWithApeShell,
  type GateDecision,
} from './wrap.js'
