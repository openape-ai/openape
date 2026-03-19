import type { GrantType, ScopeRiskLevel } from '@openape/core'

// --- Plugin Configuration ---

export interface PluginConfig {
  mode: 'local' | 'idp'
  audience: string
  defaultApproval: GrantType
  adapterPaths?: string[]

  // IdP mode
  agentEmail?: string
  agentKeyPath?: string
  idpUrl?: string

  // apes
  apes?: {
    enabled: boolean
    binaryPath?: string
  }

  // Polling (IdP mode)
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'local',
  audience: 'openclaw',
  defaultApproval: 'once',
  pollIntervalMs: 3000,
  pollTimeoutMs: 300000,
}

// --- OpenClaw Plugin API (type stubs) ---

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: ToolInput) => Promise<ToolResult>
}

export interface ToolInput {
  command: string
  reason?: string
  privileged?: boolean
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
}

export interface HookHandler {
  (context: HookContext): Promise<HookResult>
}

export interface HookContext {
  toolName: string
  toolInput: Record<string, unknown>
}

export interface HookResult {
  allow: boolean
  message?: string
}

export interface HttpRouteDefinition {
  path: string
  method: 'GET' | 'POST'
  handler: (req: HttpRequest) => Promise<HttpResponse>
}

export interface HttpRequest {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
}

export interface HttpResponse {
  status: number
  headers?: Record<string, string>
  body: unknown
}

export interface CliCommandDefinition {
  name: string
  description: string
  subcommands?: CliSubcommand[]
  handler: (args: string[]) => Promise<void>
}

export interface CliSubcommand {
  name: string
  description: string
  handler: (args: string[]) => Promise<void>
}

export interface ChannelMessage {
  text: string
  actions?: ChannelAction[]
}

export interface ChannelAction {
  label: string
  value: string
}

export interface PluginApi {
  rootDir: string
  registerTool(tool: ToolDefinition): void
  on(event: 'before_tool_call', handler: HookHandler, options?: { priority?: number }): void
  registerHttpRoute(route: HttpRouteDefinition): void
  registerCli(command: CliCommandDefinition): void

  // Channel communication
  sendChannelMessage(message: ChannelMessage): Promise<string | undefined>
  onChannelCommand(command: string, handler: (args: string[], responderId?: string) => Promise<void>): void

  // Runtime
  runtime: {
    system: {
      runCommandWithTimeout(command: string, args: string[], options?: {
        timeout?: number
        cwd?: string
        env?: Record<string, string>
      }): Promise<{ stdout: string, stderr: string, exitCode: number }>
    }
    state: {
      resolveStateDir(): string
    }
  }

  // Logging
  logger: {
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
  }
}

// --- Grant Types (plugin-internal) ---

export type GrantApproval = 'once' | 'timed' | 'always'

export interface GrantRecord {
  id: string
  permission: string
  approval: GrantApproval
  status: 'pending' | 'approved' | 'denied' | 'used' | 'expired' | 'revoked'
  command: string
  reason?: string
  risk: ScopeRiskLevel
  display: string
  jwt?: string
  createdAt: string
  decidedAt?: string
  expiresAt?: string
  usedAt?: string
}

export interface AuditEntry {
  ts: string
  event: 'grant_requested' | 'grant_approved' | 'grant_denied' | 'grant_used' | 'grant_revoked' | 'grant_expired' | 'exec_success' | 'exec_failed' | 'exec_blocked'
  grantId?: string
  permission?: string
  command?: string
  detail?: string
}
