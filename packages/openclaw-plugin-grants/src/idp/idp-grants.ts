import { hostname } from 'node:os'
import { verifyAuthzJWT } from '@openape/grants'
import { cliAuthorizationDetailCovers } from '@openape/core'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import type { PluginConfig, ToolResult } from '../types.js'
import type { ResolvedCommand, FallbackCommand } from '../adapters/types.js'
import type { GrantStore } from '../store/grant-store.js'
import type { GrantCache } from '../store/grant-cache.js'
import type { AuditLog } from '../store/audit-log.js'
import type { PluginApi } from '../types.js'
import type { AgentAuthState } from './auth.js'
import { getGrantsEndpoint, getJwksUri } from './discovery.js'
import { executeCommand } from '../execution/executor.js'

export interface IdpGrantContext {
  config: PluginConfig
  api: PluginApi
  authState: AgentAuthState
  store: GrantStore
  cache: GrantCache
  audit: AuditLog
}

export async function handleIdpGrantExec(
  ctx: IdpGrantContext,
  options: {
    resolved: ResolvedCommand | null
    fallback: FallbackCommand | null
    command: string
    reason?: string
    privileged?: boolean
  },
): Promise<ToolResult> {
  const { config, api, authState, store, cache, audit } = ctx
  const { resolved, fallback, command, reason, privileged } = options

  let permission: string
  let display: string
  let risk: string
  let detail: OpenApeCliAuthorizationDetail | null = null
  let argv: string[]

  if (resolved) {
    permission = resolved.permission
    display = resolved.detail.display
    risk = resolved.detail.risk
    detail = resolved.detail
    argv = [resolved.executable, ...resolved.commandArgv]
  }
  else if (fallback) {
    permission = fallback.permission
    display = fallback.display
    risk = fallback.risk
    argv = fallback.argv
  }
  else {
    return { success: false, error: 'Command resolution failed' }
  }

  // Cache check
  if (detail) {
    const cached = cache.lookup(permission, detail)
    if (cached) {
      api.logger.info(`[grants] IdP cache hit for ${permission}`)
      audit.write({ event: 'grant_used', grantId: cached.id, permission, command, detail: 'idp cache hit' })
      return doExecute(api, config, argv, cached.jwt, privileged)
    }
  }

  // Create grant at IdP
  const grantsEndpoint = await getGrantsEndpoint(authState.idpUrl)
  const grantBody: Record<string, unknown> = {
    requester: authState.email,
    target_host: hostname(),
    audience: config.audience,
    grant_type: config.defaultApproval,
    command: argv,
    reason: reason ?? display,
    permissions: [permission],
  }

  if (resolved) {
    grantBody.authorization_details = [resolved.detail]
    grantBody.execution_context = resolved.executionContext
  }

  const createResp = await fetch(grantsEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authState.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(grantBody),
  })

  if (!createResp.ok) {
    const text = await createResp.text()
    return { success: false, error: `IdP grant creation failed: ${createResp.status} ${text}` }
  }

  const { id: grantId } = await createResp.json() as { id: string, status: string }
  audit.write({ event: 'grant_requested', grantId, permission, command })

  // Store locally
  const localGrant = store.createGrant({ permission, command, reason, risk: risk as 'low' | 'medium' | 'high' | 'critical', display })

  // Poll for approval
  const pollInterval = config.pollIntervalMs ?? 3000
  const pollTimeout = config.pollTimeoutMs ?? 300000
  const deadline = Date.now() + pollTimeout

  while (Date.now() < deadline) {
    const statusResp = await fetch(`${grantsEndpoint}/${grantId}`, {
      headers: { Authorization: `Bearer ${authState.token}` },
    })

    if (statusResp.ok) {
      const { status } = await statusResp.json() as { status: string }
      if (status === 'approved')
        break
      if (status === 'denied' || status === 'revoked') {
        audit.write({ event: 'grant_denied', grantId, permission })
        store.denyGrant(localGrant.id)
        return { success: false, error: `Grant ${status}: ${display}` }
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  if (Date.now() >= deadline) {
    return { success: false, error: `Grant approval timed out for: ${display}` }
  }

  // Fetch authorization JWT
  const tokenResp = await fetch(`${grantsEndpoint}/${grantId}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authState.token}` },
  })

  if (!tokenResp.ok) {
    return { success: false, error: `Failed to fetch grant token: ${tokenResp.status}` }
  }

  const { authz_jwt: jwt } = await tokenResp.json() as { authz_jwt: string }

  // Verify JWT
  if (resolved) {
    const jwksUri = await getJwksUri(authState.idpUrl)
    const verifyResult = await verifyAuthzJWT(jwt, {
      expectedIss: authState.idpUrl,
      expectedAud: config.audience,
      jwksUri,
    })

    if (!verifyResult.valid) {
      return { success: false, error: `Grant JWT verification failed: ${verifyResult.error}` }
    }

    // Verify coverage
    const claims = verifyResult.claims!
    const grantedDetails = extractCliDetails(claims as unknown as Record<string, unknown>)
    if (grantedDetails.length > 0 && !grantedDetails.some(d => cliAuthorizationDetailCovers(d, resolved.detail))) {
      return { success: false, error: `Grant does not cover required permission: ${permission}` }
    }
  }

  // Update local state
  const approval = config.defaultApproval
  store.approveGrant(localGrant.id, approval)
  if (detail && approval !== 'once') {
    const updatedGrant = store.getGrant(localGrant.id)!
    updatedGrant.jwt = jwt
    cache.put(updatedGrant, detail)
  }
  store.consumeGrant(localGrant.id)

  audit.write({ event: 'grant_approved', grantId, permission, command })

  return doExecute(api, config, argv, jwt, privileged)
}

function extractCliDetails(claims: Record<string, unknown>): OpenApeCliAuthorizationDetail[] {
  const details = claims.authorization_details
  if (!Array.isArray(details))
    return []
  return details.filter((d): d is OpenApeCliAuthorizationDetail =>
    typeof d === 'object' && d !== null && (d as Record<string, unknown>).type === 'openape_cli',
  )
}

async function doExecute(api: PluginApi, config: PluginConfig, argv: string[], jwt?: string, privileged?: boolean): Promise<ToolResult> {
  const [command, ...args] = argv
  if (!command)
    return { success: false, error: 'Empty command' }

  return executeCommand(api, {
    command,
    args,
    jwt,
    privileged: privileged && config.apes?.enabled,
    apesBinaryPath: config.apes?.binaryPath ?? 'apes',
  })
}
