// Pure shapes library — re-exported from @openape/shapes
export {
  appendAuditLog,
  buildExactCommandGrantRequest,
  buildStructuredCliGrantRequest,
  extractShellCommandString,
  fetchRegistry,
  findAdapter,
  findConflictingAdapters,
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

// Grant-orchestration + CLI glue — stayed in apes
export { createShapesGrant, fetchGrantToken, findExistingGrant, verifyAndExecute, waitForGrantStatus } from './shapes/grants.js'
export { extractOption, extractWrappedCommand } from './shapes/commands/explain.js'

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
export { runApeShell } from './lib/agent-tools/ape-shell-exec'
export type { ApeShellResult } from './lib/agent-tools/ape-shell-exec'
