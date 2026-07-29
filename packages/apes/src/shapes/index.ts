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
  resolveCompoundCommand,
  resolveGenericOrReject,
  searchAdapters,
} from '@openape/shapes'
export type {
  ParsedShellCommand,
  ResolvedCommand,
  ResolvedCompound,
  ShapesOperation,
} from '@openape/shapes'
export { extractOption, extractWrappedCommand } from './commands/explain.js'
export { compoundCoveredByDetails, createCompoundGrant, createShapesGrant, fetchGrantToken, findExistingCompoundGrant, findExistingGrant, isAutoApproved, resolveFromGrant, verifyAndConsume, verifyAndConsumeCompound, verifyAndExecute, waitForGrantStatus } from './grants.js'
