// Re-export all shapes library functions (inlined from @openape/shapes)
export {
  loadAdapter,
  resolveAdapterPath,
  resolveCapabilityRequest,
  resolveCommand,
  buildExactCommandGrantRequest,
  buildStructuredCliGrantRequest,
  fetchRegistry,
  findAdapter,
  searchAdapters,
  findConflictingAdapters,
  getInstalledDigest,
  installAdapter,
  isInstalled,
  removeAdapter,
  extractWrappedCommand,
  extractOption,
  createShapesGrant,
  fetchGrantToken,
  findExistingGrant,
  verifyAndExecute,
  waitForGrantStatus,
} from './shapes/index.js'

export type {
  AdapterMeta,
  BuiltGrantRequest,
  GrantRequestOptions,
  LoadedAdapter,
  RegistryEntry,
  RegistryIndex,
  ResolvedCapability,
  ResolvedCommand,
  ShapesAdapter,
  ShapesOperation,
} from './shapes/index.js'

// Apes-specific exports
export { loadAuth, saveAuth, clearAuth, loadConfig, saveConfig, getIdpUrl, getAuthToken, getRequesterIdentity } from './config'
export type { AuthData, ApesConfig } from './config'
export { apiFetch, discoverEndpoints, ApiError } from './http'
export { parseDuration } from './duration'
export { CliError, CliExit } from './errors'
