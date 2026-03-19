import type { GrantType, OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail, OpenApeGrantRequest } from '@openape/core'
import { canonicalizeCliPermission, computeArgvHash, computeCmdHash, validateCliAuthorizationDetail } from '@openape/core'
import { createGrant } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { tryAgentAuth } from '../../utils/agent-auth'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

function normalizeAuthorizationDetails(details?: OpenApeAuthorizationDetail[]): OpenApeAuthorizationDetail[] | undefined {
  if (!details?.length)
    return undefined

  return details.map((detail) => {
    if (detail.type !== 'openape_cli')
      return detail

    const result = validateCliAuthorizationDetail(detail)
    if (!result.valid) {
      throw createProblemError({
        status: 400,
        title: `Invalid authorization_details entry: ${result.errors.join('; ')}`,
      })
    }

    const permission = canonicalizeCliPermission(detail)
    return {
      ...detail,
      permission,
    } satisfies OpenApeCliAuthorizationDetail
  })
}

function detailSignature(detail: OpenApeAuthorizationDetail): string {
  if (detail.type !== 'openape_cli')
    return JSON.stringify(detail)

  const normalizedChain = detail.resource_chain.map(resource => ({
    resource: resource.resource,
    ...(resource.selector
      ? { selector: Object.fromEntries(Object.entries(resource.selector).sort(([a], [b]) => a.localeCompare(b))) }
      : {}
    ),
  }))

  return JSON.stringify({
    ...detail,
    permission: canonicalizeCliPermission(detail),
    resource_chain: normalizedChain,
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OpenApeGrantRequest>(event)
  const { grantStore } = useGrantStores()

  const agentPayload = await tryAgentAuth(event)
  if (agentPayload) {
    body.requester = agentPayload.sub
  }

  if (!body.requester || !body.target_host || !body.audience) {
    throw createProblemError({ status: 400, title: 'Missing required fields: requester, target_host, audience' })
  }

  // Default grant_type to 'once'
  if (!body.grant_type) {
    body.grant_type = 'once'
  }

  if (!VALID_GRANT_TYPES.includes(body.grant_type)) {
    throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}`, type: 'https://openape.org/errors/invalid_grant_type' })
  }

  if (body.grant_type === 'timed' && !body.duration) {
    throw createProblemError({ status: 400, title: 'Duration is required for timed grants', type: 'https://openape.org/errors/missing_duration' })
  }

  body.authorization_details = normalizeAuthorizationDetails(body.authorization_details)

  if (body.authorization_details?.length) {
    body.permissions = body.authorization_details.map(detail =>
      detail.type === 'openape_cli' ? canonicalizeCliPermission(detail) : detail.action,
    )
  }

  if (body.execution_context?.argv?.length) {
    body.execution_context = {
      ...body.execution_context,
      argv_hash: await computeArgvHash(body.execution_context.argv),
      resolved_executable: body.execution_context.resolved_executable || body.execution_context.argv[0] || '',
    }
    if (!body.command?.length) {
      body.command = [...body.execution_context.argv]
    }
  }

  // Compute cmd_hash server-side from command array (never trust client-provided hash)
  if (body.command?.length) {
    body.cmd_hash = await computeCmdHash(body.command.join(' '))
  }

  // Grant-Reuse: check for an active reusable grant with matching parameters
  // Only timed/always grants are reusable (once grants are single-use by definition)
  {
    const existingGrants = await grantStore.findByRequester(body.requester)
    const now = Math.floor(Date.now() / 1000)
    const reusable = existingGrants.find((g) => {
      if (g.status !== 'approved') return false
      if ((g.request.grant_type ?? 'once') === 'once') return false
      if (g.expires_at && g.expires_at <= now) return false
      if (g.request.target_host !== body.target_host) return false
      if (g.request.audience !== body.audience) return false
      if (g.request.run_as !== (body.run_as ?? undefined)) return false
      if ((g.request.execution_context?.adapter_digest ?? undefined) !== (body.execution_context?.adapter_digest ?? undefined)) return false
      // Match by cmd_hash (server-computed from command)
      if (body.cmd_hash || g.request.cmd_hash) {
        if (g.request.cmd_hash !== body.cmd_hash) return false
      }
      // Match permissions if present
      if (body.permissions || g.request.permissions) {
        const reqPerms = (body.permissions ?? []).toSorted().join(',')
        const grantPerms = (g.request.permissions ?? []).toSorted().join(',')
        if (reqPerms !== grantPerms) return false
      }
      if (body.authorization_details || g.request.authorization_details) {
        const reqDetails = (body.authorization_details ?? []).map(detailSignature).toSorted().join(',')
        const grantDetails = (g.request.authorization_details ?? []).map(detailSignature).toSorted().join(',')
        if (reqDetails !== grantDetails) return false
      }
      // Match delegation fields
      if (body.delegator !== (g.request.delegator ?? undefined)) return false
      if (body.delegate !== (g.request.delegate ?? undefined)) return false
      return true
    })
    if (reusable) {
      return reusable
    }
  }

  const grant = await createGrant(body, grantStore)
  setResponseStatus(event, 201)
  return grant
})
