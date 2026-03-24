// Re-export all shapes library functions
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
} from '@openape/shapes'

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
} from '@openape/shapes'

// Apes-specific exports
export { loadAuth, saveAuth, clearAuth, loadConfig, saveConfig, getIdpUrl, getAuthToken, getRequesterIdentity } from './config'
export type { AuthData, ApesConfig } from './config'
export { apiFetch, discoverEndpoints, ApiError } from './http'
export { parseDuration } from './duration'
