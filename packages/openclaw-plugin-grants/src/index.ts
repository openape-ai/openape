import type {
  HookContext,
  HookResult,
  PluginApi,
  PluginConfig,
  ToolInput,
  ToolResult,
} from './types.js'
import { DEFAULT_CONFIG } from './types.js'

export type { PluginApi, PluginConfig } from './types.js'

const BLOCKED_TOOLS = new Set(['exec', 'bash', 'shell', 'run_command'])

export function register(api: PluginApi, userConfig?: Partial<PluginConfig>): void {
  const config: PluginConfig = { ...DEFAULT_CONFIG, ...userConfig }

  api.log.info(`[grants] Initializing in ${config.mode} mode`)

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
      // Stub — full implementation in M3
      return {
        success: false,
        error: 'grant_exec not yet implemented (stub)',
      }
    },
  })

  // --- Hook: before_tool_call → block exec/bash ---
  api.on('before_tool_call', async (context: HookContext): Promise<HookResult> => {
    if (BLOCKED_TOOLS.has(context.toolName)) {
      api.log.warn(`[grants] Blocked tool: ${context.toolName} — use grant_exec instead`)
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
    handler: async () => {
      // Stub — full implementation in M3 (local JWT)
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { keys: [] },
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
          // Stub — full implementation in M6
          console.log(`Mode: ${config.mode}`)
          console.log('Status: initialized (stub)')
        },
      },
      {
        name: 'list',
        description: 'List all grants',
        handler: async () => {
          console.log('No grants yet (stub)')
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
          console.log(`Revoke grant ${id} (stub)`)
        },
      },
      {
        name: 'adapters',
        description: 'List loaded adapters and their operations',
        handler: async () => {
          console.log('No adapters loaded yet (stub)')
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
