/**
 * Minimal local declaration of the slice of OpenClaw's plugin SDK this package
 * uses.
 *
 * OpenClaw is a peer dependency installed globally on the host, not a
 * workspace dependency, so its types are not resolvable at build time here.
 * Vendoring the real SDK for two type names would pull a very large dependency
 * into the monorepo for no benefit; the plugin entry that consumes these types
 * is thin wiring, and the milestone proof is a live run against the real host.
 *
 * Shapes mirror `src/plugins/hook-types.ts` and
 * `src/plugins/hook-before-tool-call-result.ts` in OpenClaw 2026.8.1. If a
 * future OpenClaw changes them, the live-run proof fails loudly rather than
 * this file silently disagreeing.
 */
declare module 'openclaw/plugin-sdk/plugin-entry' {
  export type PluginApprovalResolution =
    | 'allow-once'
    | 'allow-always'
    | 'deny'
    | 'timeout'
    | 'cancelled'

  export interface PluginHookBeforeToolCallResult {
    params?: Record<string, unknown>
    block?: boolean
    blockReason?: string
    requireApproval?: {
      title: string
      description: string
      severity?: 'info' | 'warning' | 'critical'
      timeoutMs?: number
      timeoutReason?: string
      allowedDecisions?: Array<'allow-once' | 'allow-always' | 'deny'>
      pluginId?: string
      onResolution?: (decision: PluginApprovalResolution) => Promise<void> | void
    }
  }

  export interface PluginHookBeforeToolCallEvent {
    toolName: string
    params: Record<string, unknown>
    toolKind?: string
    toolInputKind?: string
    runId?: string
    toolCallId?: string
    derivedPaths?: readonly string[]
    context?: { pluginConfig?: unknown }
  }

  export interface PluginHookToolContext {
    agentId?: string
    sessionKey?: string
    abortSignal?: AbortSignal
  }

  export interface PluginLogger {
    error?: (message: string) => void
    warn?: (message: string) => void
    info?: (message: string) => void
  }

  export interface PluginRegisterApi {
    id: string
    /**
     * Operator config for this plugin. Lives on the registration API, not on
     * the hook event — see the note in src/plugin.ts.
     */
    pluginConfig?: Record<string, unknown>
    logger?: PluginLogger
    on: (
      hook: 'before_tool_call',
      handler: (
        event: PluginHookBeforeToolCallEvent,
        ctx: PluginHookToolContext,
      ) => Promise<PluginHookBeforeToolCallResult | void> | PluginHookBeforeToolCallResult | void,
      opts?: { matcher?: string[], priority?: number, timeoutMs?: number, registrationId?: string },
    ) => void
  }

  export interface PluginEntryDefinition {
    id: string
    name: string
    description?: string
    register: (api: PluginRegisterApi) => void
  }

  export function definePluginEntry(definition: PluginEntryDefinition): PluginEntryDefinition
}
