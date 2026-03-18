import type {
  HookContext,
  HookResult,
  PluginApi,
  PluginConfig,
  ToolInput,
  ToolResult,
} from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { discoverAdapters } from './adapters/loader.js'
import type { LoadedAdapter } from './adapters/types.js'
import { GrantStore } from './store/grant-store.js'
import { GrantCache } from './store/grant-cache.js'
import { AuditLog } from './store/audit-log.js'
import { LocalJwtSigner } from './local/local-jwt.js'
import { ChannelApproval } from './approval/channel-approval.js'
import { handleGrantExec } from './tools/grant-exec.js'
import { authenticateAgent, isTokenExpired } from './idp/auth.js'
import type { AgentAuthState } from './idp/auth.js'
import { discoverIdpUrl } from './idp/discovery.js'

export type { PluginApi, PluginConfig } from './types.js'
export {
  parseAdapterToml,
  resolveCommand,
  resolveCommandFromAdapters,
  createFallbackCommand,
  parseCommandString,
  loadAdapter,
  loadAdapterFromFile,
  discoverAdapters,
} from './adapters/index.js'
export type {
  AdapterDefinition,
  AdapterOperation,
  CommandResolutionResult,
  FallbackCommand,
  LoadedAdapter,
  ResolvedCommand,
  AdapterSearchPaths,
} from './adapters/index.js'
export { GrantStore } from './store/grant-store.js'
export { GrantCache } from './store/grant-cache.js'
export { AuditLog } from './store/audit-log.js'
export { LocalJwtSigner } from './local/local-jwt.js'
export { ChannelApproval } from './approval/channel-approval.js'
export { executeCommand } from './execution/executor.js'
export { detectApes, buildApesArgs } from './execution/apes.js'
export { handleGrantExec } from './tools/grant-exec.js'
export { authenticateAgent, isTokenExpired } from './idp/auth.js'
export type { AgentAuthState } from './idp/auth.js'
export { discoverIdpUrl, discoverEndpoints, getGrantsEndpoint, clearDiscoveryCache } from './idp/discovery.js'
export { handleIdpGrantExec } from './idp/idp-grants.js'

const BLOCKED_TOOLS = new Set(['exec', 'bash', 'shell', 'run_command'])

export function register(api: PluginApi, userConfig?: Partial<PluginConfig>): void {
  const config: PluginConfig = { ...DEFAULT_CONFIG, ...userConfig }

  api.log.info(`[grants] Initializing in ${config.mode} mode`)

  // --- State ---
  const stateDir = api.runtime.config.getStateDir()
  const workspaceDir = api.runtime.config.getWorkspaceDir()

  const store = new GrantStore(stateDir)
  const cache = new GrantCache()
  const audit = new AuditLog(stateDir)

  // --- Adapters ---
  const adapters: LoadedAdapter[] = discoverAdapters({
    explicit: config.adapterPaths,
    workspaceDir,
  })
  api.log.info(`[grants] Loaded ${adapters.length} adapters: ${adapters.map(a => a.adapter.cli.id).join(', ')}`)

  // --- Local Mode Setup ---
  let localJwt: LocalJwtSigner | null = null
  let channelApproval: ChannelApproval | null = null

  if (config.mode === 'local') {
    localJwt = new LocalJwtSigner(stateDir)
    channelApproval = new ChannelApproval(api, store, config.pollTimeoutMs)

    // Init key pair asynchronously
    localJwt.init().catch((error) => {
      api.log.error(`[grants] Failed to init local JWT: ${error}`)
    })
  }

  // --- IdP Mode Setup ---
  let idpAuthState: AgentAuthState | null = null

  if (config.mode === 'idp') {
    if (!config.agentEmail || !config.agentKeyPath) {
      api.log.error('[grants] IdP mode requires agentEmail and agentKeyPath')
    }
    else {
      // Init auth asynchronously
      discoverIdpUrl(config.agentEmail, config.idpUrl)
        .then(idpUrl => authenticateAgent({
          idpUrl,
          email: config.agentEmail!,
          keyPath: config.agentKeyPath!,
        }))
        .then((state) => {
          idpAuthState = state
          api.log.info(`[grants] IdP auth OK: ${state.email} @ ${state.idpUrl}`)
        })
        .catch((error) => {
          api.log.error(`[grants] IdP auth failed: ${error}`)
        })
    }
  }

  // --- Tool: grant_exec ---
  api.registerTool({
    name: 'grant_exec',
    description: [
      'Execute a CLI command with grant-based authorization.',
      'Commands are resolved against adapters for granular permissions.',
      'The owner must approve the grant before execution proceeds.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The full CLI command to execute (e.g. "gh pr merge 42 --repo openape/core")',
        },
        reason: {
          type: 'string',
          description: 'Why this command needs to be executed',
        },
        privileged: {
          type: 'boolean',
          description: 'Whether this command requires elevated privileges (via apes)',
        },
      },
      required: ['command'],
    },
    handler: async (input: ToolInput): Promise<ToolResult> => {
      api.log.info(`[grants] grant_exec called: ${input.command}`)
      return handleGrantExec(
        { config, api, adapters, store, cache, audit, localJwt, channelApproval, idpAuthState },
        input,
      )
    },
  })

  // --- Hook: before_tool_call → block exec/bash ---
  api.on('before_tool_call', async (context: HookContext): Promise<HookResult> => {
    if (BLOCKED_TOOLS.has(context.toolName)) {
      api.log.warn(`[grants] Blocked tool: ${context.toolName} — use grant_exec instead`)
      audit.write({ event: 'exec_blocked', command: String(context.toolInput.command ?? context.toolName) })
      return {
        allow: false,
        message: `Direct command execution via "${context.toolName}" is disabled. Use grant_exec instead for authorized command execution.`,
      }
    }
    return { allow: true }
  }, { priority: 100 })

  // --- HTTP Route: JWKS ---
  api.registerHttpRoute({
    path: '/grants/.well-known/jwks.json',
    method: 'GET',
    handler: async (): Promise<{ status: number, headers: Record<string, string>, body: unknown }> => {
      if (!localJwt) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'JWKS not available in IdP mode' },
        }
      }

      try {
        const jwks = await localJwt.getJwks()
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
          body: jwks,
        }
      }
      catch {
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'JWKS not ready' },
        }
      }
    },
  })

  // --- CLI: openclaw grants ---
  api.registerCli({
    name: 'grants',
    description: 'Manage grant-based command execution',
    subcommands: [
      {
        name: 'status',
        description: 'Show grant system status (mode, auth, active grants)',
        handler: async () => {
          console.log(`Mode: ${config.mode}`)
          console.log(`Adapters: ${adapters.length} loaded`)
          console.log(`Active grants: ${store.getActiveGrantCount()}`)
          console.log(`Cache entries: ${cache.size()}`)
        },
      },
      {
        name: 'list',
        description: 'List all grants',
        handler: async () => {
          const grants = store.listGrants()
          if (grants.length === 0) {
            console.log('No grants')
            return
          }
          for (const g of grants) {
            console.log(`${g.id} [${g.status}] ${g.permission} (${g.approval})`)
          }
        },
      },
      {
        name: 'revoke',
        description: 'Revoke a grant by ID',
        handler: async (args: string[]) => {
          const id = args[0]
          if (!id) {
            console.error('Usage: openclaw grants revoke <grant-id>')
            return
          }
          const success = store.revokeGrant(id)
          if (success) {
            cache.remove(store.getGrant(id)?.permission ?? '')
            audit.write({ event: 'grant_revoked', grantId: id })
            console.log(`Grant ${id} revoked`)
          }
          else {
            console.error(`Grant ${id} not found or cannot be revoked`)
          }
        },
      },
      {
        name: 'adapters',
        description: 'List loaded adapters and their operations',
        handler: async () => {
          if (adapters.length === 0) {
            console.log('No adapters loaded')
            return
          }
          for (const a of adapters) {
            console.log(`\n${a.adapter.cli.id} (${a.adapter.cli.executable})`)
            for (const op of a.adapter.operations) {
              console.log(`  ${op.id}: ${op.display} [${op.risk}]`)
            }
          }
        },
      },
    ],
    handler: async (args: string[]) => {
      console.log(`Unknown subcommand: ${args.join(' ')}`)
      console.log('Available: status, list, revoke, adapters')
    },
  })

  api.log.info('[grants] Plugin registered successfully')
}
