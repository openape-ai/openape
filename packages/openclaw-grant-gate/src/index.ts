export {
  authFileFor,
  DEFAULT_APE_SHELL_PATH,
  DEFAULT_WAIT_TIMEOUT_MS,
  GateConfigError,
  readGateConfig,
  type GateConfig,
} from './config.js'
export {
  DEFAULT_IDP_URL,
  preflightExec,
  relayApproval,
  type PreflightOutcome,
} from './gate.js'
export {
  approveGrant,
  buildGrantRequestFor,
  createGrant,
  denyGrant,
  grantTypeForDecision,
  isDecided,
  readGrantStatus,
  waitForDecision,
  type CreatedGrant,
  type GrantDecision,
  type GrantType,
} from './grants.js'
export { resolveIdentity, type Identity } from './identity.js'
export {
  decideExec,
  isAlreadyWrapped,
  wrapWithApeShell,
  type GateDecision,
} from './wrap.js'
