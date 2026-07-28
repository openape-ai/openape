export {
  appendAuditLog,
  buildStructuredCliGrantRequest,
  buildGenericResolved,
  extractShellCommandString,
  fetchRegistry,
  findAdapter,
  findConflictingAdapters,
  GENERIC_OPERATION_ID,
  getInstalledDigest,
  installAdapter,
  isInstalled,
  loadAdapter,
  loadOrInstallAdapter,
  parseShellCommand,
  removeAdapter,
  resolveCapabilityRequest,
  resolveCommand,
  resolveGenericOrReject,
  searchAdapters,
} from '@openape/shapes'
export type {
  ParsedShellCommand,
  ResolvedCommand,
  ShapesOperation,
} from '@openape/shapes'
export { extractOption, extractWrappedCommand } from './commands/explain.js'
export { createShapesGrant, fetchGrantToken, findExistingGrant, resolveFromGrant, verifyAndConsume, verifyAndExecute, waitForGrantStatus } from './grants.js'
