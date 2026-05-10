// Re-export all shapes subsystem library functions
export {
  appendAuditLog,
  buildExactCommandGrantRequest,
  buildStructuredCliGrantRequest,
  createShapesGrant,
  extractOption,
  extractShellCommandString,
  extractWrappedCommand,
  fetchGrantToken,
  fetchRegistry,
  findAdapter,
  findConflictingAdapters,
  findExistingGrant,
  getInstalledDigest,
  installAdapter,
  isInstalled,
  loadAdapter,
  loadOrInstallAdapter,
  parseShellCommand,
  removeAdapter,
  resolveAdapterPath,
  resolveCapabilityRequest,
  resolveCommand,
  searchAdapters,
  tryLoadAdapter,
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

// Agent-runtime: callable in-process from the chat-bridge so it doesn't
// need to spawn `apes agents serve --rpc` per turn. Same loop the
// stdio-RPC server runs internally — see commands/agents/serve.ts.
export { runLoop, RpcSessionMap } from './lib/agent-runtime'
export type {
  ChatMessage,
  RunOptions,
  RunResult,
  RuntimeConfig,
  RunStreamHandlers,
  TraceEntry,
} from './lib/agent-runtime'
export { taskTools, TOOLS } from './lib/agent-tools'
export type { ToolDefinition } from './lib/agent-tools'
