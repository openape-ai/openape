import type { PluginApi, PluginConfig, ToolInput, ToolResult } from '../types.js'
import type { LoadedAdapter, ResolvedCommand } from '../adapters/types.js'
import { resolveCommandFromAdapters } from '../adapters/parser.js'
import type { GrantStore } from '../store/grant-store.js'
import type { GrantCache } from '../store/grant-cache.js'
import type { AuditLog } from '../store/audit-log.js'
import type { LocalJwtSigner } from '../local/local-jwt.js'
import type { ChannelApproval } from '../approval/channel-approval.js'
import { executeCommand } from '../execution/executor.js'
import { handleIdpGrantExec } from '../idp/idp-grants.js'
import type { AgentAuthState } from '../idp/auth.js'
import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext } from '@openape/core'

export interface GrantExecContext {
  config: PluginConfig
  api: PluginApi
  adapters: LoadedAdapter[]
  store: GrantStore
  cache: GrantCache
  audit: AuditLog
  localJwt: LocalJwtSigner | null
  channelApproval: ChannelApproval | null
  idpAuthState: AgentAuthState | null
}

export async function handleGrantExec(
  ctx: GrantExecContext,
  input: ToolInput,
): Promise<ToolResult> {
  const { config, api, adapters, store, cache, audit } = ctx

  // 1. Resolve command against adapters
  const resolution = await resolveCommandFromAdapters(adapters, input.command)

  let permission: string
  let display: string
  let risk: string
  let detail: OpenApeCliAuthorizationDetail | null = null
  let executionContext: OpenApeExecutionContext | null = null
  let argv: string[]

  if (resolution.resolved) {
    const r = resolution.resolved
    permission = r.permission
    display = r.detail.display
    risk = r.detail.risk
    detail = r.detail
    executionContext = r.executionContext
    argv = [r.executable, ...r.commandArgv]
  }
  else if (resolution.fallback) {
    const f = resolution.fallback
    permission = f.permission
    display = f.display
    risk = f.risk
    argv = f.argv
  }
  else {
    return { success: false, error: 'Command resolution failed' }
  }

  // 2. Check cache
  if (detail) {
    const cached = cache.lookup(permission, detail)
    if (cached) {
      api.logger.info(`[grants] Cache hit for ${permission}`)
      audit.write({ event: 'grant_used', grantId: cached.id, permission, command: input.command, detail: 'cache hit' })
      return doExecute(ctx, argv, input, cached.jwt)
    }
  }

  // 3. Create grant and request approval
  const grant = store.createGrant({
    permission,
    command: input.command,
    reason: input.reason,
    risk: risk as 'low' | 'medium' | 'high' | 'critical',
    display,
  })

  audit.write({ event: 'grant_requested', grantId: grant.id, permission, command: input.command })

  // 4. Approval flow (local mode)
  if (config.mode === 'local') {
    if (!ctx.channelApproval) {
      return { success: false, error: 'Channel approval not available' }
    }

    const result = await ctx.channelApproval.requestApproval(grant)
    if (!result.approved) {
      audit.write({ event: 'grant_denied', grantId: grant.id, permission })
      return { success: false, error: `Grant denied for: ${display}` }
    }

    // Re-read the grant (approval updates it)
    const approvedGrant = store.getGrant(grant.id)
    if (!approvedGrant || approvedGrant.status !== 'approved') {
      return { success: false, error: 'Grant not in approved state' }
    }

    // 5. Sign local JWT
    let jwt: string | undefined
    if (ctx.localJwt && detail && executionContext) {
      jwt = await ctx.localJwt.signGrant({
        grant: approvedGrant,
        audience: config.audience,
        detail,
        executionContext,
      })
      approvedGrant.jwt = jwt
    }

    // 6. Cache if not once
    if (detail && approvedGrant.approval !== 'once') {
      cache.put(approvedGrant, detail)
    }

    // 7. Execute
    store.consumeGrant(approvedGrant.id)
    audit.write({ event: 'grant_approved', grantId: approvedGrant.id, permission, command: input.command })
    return doExecute(ctx, argv, input, jwt)
  }

  // IdP mode
  if (config.mode === 'idp') {
    if (!ctx.idpAuthState) {
      return { success: false, error: 'IdP authentication not available. Check agentEmail and agentKeyPath config.' }
    }

    return handleIdpGrantExec(
      { config, api, authState: ctx.idpAuthState, store, cache, audit },
      { resolved: resolution.resolved, fallback: resolution.fallback, command: input.command, reason: input.reason, privileged: input.privileged },
    )
  }

  return { success: false, error: `Unknown mode: ${config.mode}` }
}

async function doExecute(
  ctx: GrantExecContext,
  argv: string[],
  input: ToolInput,
  jwt?: string,
): Promise<ToolResult> {
  const { config, api, audit } = ctx
  const [command, ...args] = argv

  if (!command) {
    return { success: false, error: 'Empty command' }
  }

  const privileged = input.privileged && config.apes?.enabled
  const result = await executeCommand(api, {
    command,
    args,
    jwt,
    privileged,
    apesBinaryPath: config.apes?.binaryPath ?? 'apes',
  })

  audit.write({
    event: result.success ? 'exec_success' : 'exec_failed',
    command: input.command,
    detail: result.error,
  })

  return result
}
