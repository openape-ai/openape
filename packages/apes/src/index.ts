// Pure shapes library — re-exported from @openape/shapes
export {
  appendAuditLog,
  buildExactCommandGrantRequest,
  buildStructuredCliGrantRequest,
  checkCliVersion,
  exactCommand,
  extractShellCommandString,
  fetchRegistry,
  findAdapter,
  findConflictingAdapters,
  getInstalledDigest,
  installAdapter,
  installedAdapterPath,
  isInstalled,
  loadAdapter,
  loadOrInstallAdapter,
  loadRegistryAdapter,
  parseShellCommand,
  RegistryAdapterError,
  removeAdapter,
  resolveAdapterPath,
  resolveCapabilityRequest,
  resolveCommand,
  searchAdapters,
  tryLoadAdapter,
} from '@openape/shapes'

export type {
  AdapterMeta,
  BuiltGrantRequest,
  CliVersionCheck,
  GrantRequestOptions,
  LoadedAdapter,
  RegistryAdapter,
  RegistryAdapterProblem,
  RegistryEntry,
  RegistryIndex,
  ResolvedCapability,
  ResolvedCommand,
  ShapesAdapter,
  ShapesOperation,
} from '@openape/shapes'

// Grant-orchestration + CLI glue — stayed in apes
export { createShapesGrant, fetchGrantToken, findExistingGrant, verifyAndExecute, waitForGrantStatus } from './shapes/grants.js'
export { extractOption, extractWrappedCommand } from './shapes/commands/explain.js'

// Apes-specific exports
export { loadAuth, saveAuth, clearAuth, loadConfig, saveConfig, getIdpUrl, getAuthToken, getRequesterIdentity } from './config'
export type { AuthData, ApesConfig } from './config'
export { apiFetch, discoverEndpoints, ApiError } from './http'
export { materializeSecrets, startSecretsWatcher } from './lib/agent-secrets-runtime'
export { parseDuration } from './duration'
export { CliError, CliExit } from './errors'

// Agent-runtime: callable in-process from the chat-bridge so it doesn't
// need to spawn `apes agents serve --rpc` per turn. Same loop the
// stdio-RPC server runs internally — see commands/agents/serve.ts.
export { runLoop, RpcSessionMap, taskTools, TOOLS, runApeShell, addReadRoot } from '@openape/agent-runtime'
export type {
  ChatMessage,
  RunOptions,
  RunResult,
  RuntimeConfig,
  RunStreamHandlers,
  TraceEntry,
  ToolDefinition,
  ApeShellResult,
} from '@openape/agent-runtime'

export { authorizeAssignedCommand } from './shapes/assigned'
export type { AssignedCommand } from './shapes/assigned'
export type { AssignedGrantScope } from './shapes/grants'
