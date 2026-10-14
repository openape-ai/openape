export { appendAuditLog } from './audit.js'
export type { AuditEntry } from './audit.js'
export { loadAdapter, resolveAdapterPath, resolveGenericOrReject, tryLoadAdapter } from './adapters.js'
export { resolveCapabilityRequest } from './capabilities.js'
export { buildExactCommandGrantRequest, buildStructuredCliGrantRequest } from './request-builders.js'
export { parseShellCommand, extractShellCommandString, loadOrInstallAdapter } from './shell-parser.js'
export type { ParsedShellCommand } from './shell-parser.js'
export { resolveCommand } from './parser.js'
export { adapterFileDigest, semanticAdapterDigest } from './digest.js'
export { parseAdapterToml } from './toml.js'
export { fetchRegistry, findAdapter, searchAdapters } from './registry.js'
export { findConflictingAdapters, getInstalledDigest, installAdapter, installedAdapterPath, isInstalled, removeAdapter } from './installer.js'
export { RegistryAdapterError, bindsExecutable, checkCliVersion, exactCommand, loadRegistryAdapter } from './registry-adapter.js'
export type { CliVersionCheck, RegistryAdapter, RegistryAdapterProblem } from './registry-adapter.js'
export { discoverEndpoints, apiFetch, getGrantsEndpoint } from './http.js'
export { getIdpUrl, getAuthToken, loadAuth, getRequesterIdentity } from './config.js'
export { GENERIC_OPERATION_ID, buildGenericAdapter, buildGenericResolved, isGenericResolved } from './generic.js'
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
} from './types.js'
export { resolveCompoundCommand } from './compound.js'
export type { ResolvedCompound } from './compound.js'
