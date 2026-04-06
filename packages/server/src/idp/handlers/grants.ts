import type { GrantStatus, GrantType, OpenApeGrantRequest, ProblemDetails } from '@openape/core'
import type { ApproveGrantOverrides } from '@openape/grants'
import { approveGrant, createGrant, denyGrant, introspectGrant, issueAuthzJWT, revokeGrant, useGrant, verifyAuthzJWT } from '@openape/grants'
import { defineEventHandler, getHeader, getQuery, getRequestHeader, getRouterParam, readBody, setResponseHeader, setResponseStatus } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { verifyBearerAuth } from '../utils/bearer-auth.js'
import { hasManagementToken } from './admin.js'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

function requireBearerIdentity(payload: { sub: string } | null): string {
  if (!payload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  return payload.sub
}

function requireManagementOrBearer(
  event: import('h3').H3Event,
  config: IdPConfig,
  bearerPayload: { sub: string } | null,
): string {
  if (hasManagementToken(event, config)) {
    return '_management_'
  }
  return requireBearerIdentity(bearerPayload)
}

// --- List Grants ---
export function createListGrantsHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
    const cursor = query.cursor ? String(query.cursor) : undefined
    const status = query.status ? String(query.status) as GrantStatus : undefined
    const requester = query.requester ? String(query.requester) : undefined

    if (requester) {
      return stores.grantStore.listGrants({ limit, cursor, status, requester })
    }

    const identity = requireBearerIdentity(bearerPayload)

    // Get self + owned agents → single IN query
    const ownedUsers = await stores.userStore.findByOwner(identity)
    const requesters = [identity, ...ownedUsers.map(u => u.email)]

    return stores.grantStore.listGrants({ limit, cursor, status, requester: requesters })
  })
}

// --- Create Grant ---
export function createCreateGrantHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const body = await readBody<OpenApeGrantRequest>(event)
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

    if (bearerPayload) {
      body.requester = bearerPayload.sub
    }

    if (!body.requester || !body.target_host || !body.audience) {
      throw createProblemError({ status: 400, title: 'Missing required fields: requester, target_host, audience' })
    }

    if (!body.grant_type) {
      body.grant_type = 'once'
    }

    if (!VALID_GRANT_TYPES.includes(body.grant_type)) {
      throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
    }

    if (body.grant_type === 'timed' && !body.duration) {
      throw createProblemError({ status: 400, title: 'Duration is required for timed grants' })
    }

    const grant = await createGrant(body, stores.grantStore)
    setResponseStatus(event, 201)
    return grant
  })
}

// --- Get Grant ---
export function createGetGrantHandler(stores: IdPStores) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')!

    const grant = await introspectGrant(id, stores.grantStore)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    const etag = `W/"${grant.status}:${grant.decided_at || grant.created_at}"`
    setResponseHeader(event, 'ETag', etag)

    const ifNoneMatch = getRequestHeader(event, 'if-none-match')
    if (ifNoneMatch === etag) {
      setResponseStatus(event, 304)
      return ''
    }

    return grant
  })
}

// --- Approve Grant ---
export function createApproveGrantHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')!

    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const email = requireManagementOrBearer(event, config, bearerPayload)

    const body = await readBody(event).catch(() => ({})) as Record<string, unknown>

    if (body.grant_type !== undefined) {
      if (!VALID_GRANT_TYPES.includes(body.grant_type as GrantType)) {
        throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
      }
      if (body.grant_type === 'timed' && (!body.duration || typeof body.duration !== 'number' || body.duration <= 0)) {
        throw createProblemError({ status: 400, title: 'Duration must be a positive number for timed grants' })
      }
    }

    const grant = await stores.grantStore.findById(id)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    // Authorize: requester can self-approve, or owner/approver of the requester's agent
    if (email !== '_management_') {
      const isRequester = grant.request.requester === email
      if (!isRequester) {
        const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
        if (!requesterUser) {
          throw createProblemError({ status: 403, title: 'Requester user not found for this grant' })
        }
        const isOwnerOrApprover = requesterUser.owner === email || requesterUser.approver === email
        if (!isOwnerOrApprover) {
          throw createProblemError({ status: 403, title: 'Only the requester, owner, or approver can approve this grant' })
        }
      }
    }

    try {
      const overrides: ApproveGrantOverrides | undefined = body.grant_type
        ? { grant_type: body.grant_type as GrantType, duration: body.duration as number | undefined }
        : undefined
      const approved = await approveGrant(id, email, stores.grantStore, overrides)

      const signingKey = await stores.keyStore.getSigningKey()
      const authzJwt = await issueAuthzJWT(approved, config.issuer, signingKey.privateKey, signingKey.kid)
      return { grant: approved, authz_jwt: authzJwt }
    }
    catch (err: unknown) {
      if (err && typeof err === 'object' && 'statusCode' in err) throw err
      const message = err instanceof Error ? err.message : 'Failed to approve grant'
      throw createProblemError({ status: 400, title: message })
    }
  })
}

// --- Deny Grant ---
export function createDenyGrantHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')!

    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const email = requireManagementOrBearer(event, config, bearerPayload)

    const grant = await stores.grantStore.findById(id)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    if (email !== '_management_') {
      const isRequester = grant.request.requester === email
      if (!isRequester) {
        const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
        if (!requesterUser) {
          throw createProblemError({ status: 403, title: 'Requester user not found for this grant' })
        }
        const isOwnerOrApprover = requesterUser.owner === email || requesterUser.approver === email
        if (!isOwnerOrApprover) {
          throw createProblemError({ status: 403, title: 'Only the requester, owner, or approver can deny this grant' })
        }
      }
    }

    try {
      const denied = await denyGrant(id, email, stores.grantStore)
      return denied
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to deny grant'
      throw createProblemError({ status: 400, title: message })
    }
  })
}

// --- Revoke Grant ---
export function createRevokeGrantHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')!

    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const identity = requireManagementOrBearer(event, config, bearerPayload)

    const grant = await stores.grantStore.findById(id)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    if (identity !== '_management_') {
      const isRequester = grant.request.requester === identity
      if (!isRequester) {
        const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
        const isApprover = requesterUser && requesterUser.approver === identity
        const isAdmin = config.adminEmails?.includes(identity)
        if (!isApprover && !isAdmin) {
          throw createProblemError({ status: 403, title: 'Only the requester, approver, or admin can revoke this grant' })
        }
      }
    }

    try {
      const revoked = await revokeGrant(id, stores.grantStore)
      return revoked
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke grant'
      throw createProblemError({ status: 400, title: message })
    }
  })
}

// --- Grant Token ---
export function createGrantTokenHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const identity = requireBearerIdentity(bearerPayload)

    const id = getRouterParam(event, 'id')!

    const grant = await introspectGrant(id, stores.grantStore)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    if (grant.request.requester !== identity) {
      throw createProblemError({ status: 403, title: 'Grant does not belong to this identity' })
    }

    if (grant.status !== 'approved') {
      throw createProblemError({ status: 400, title: `Grant is not approved (status: ${grant.status})` })
    }

    const signingKey = await stores.keyStore.getSigningKey()
    const authzJwt = await issueAuthzJWT(grant, config.issuer, signingKey.privateKey, signingKey.kid)

    return { authz_jwt: authzJwt, grant }
  })
}

// --- Consume Grant ---
export function createConsumeGrantHandler(stores: IdPStores) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')!

    const authHeader = getHeader(event, 'authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      throw createProblemError({ status: 401, title: 'Missing or invalid Authorization header' })
    }
    const token = authHeader.slice(7)

    const signingKey = await stores.keyStore.getSigningKey()
    const result = await verifyAuthzJWT(token, {
      publicKey: signingKey.publicKey,
    })

    if (!result.valid) {
      throw createProblemError({ status: 401, title: `Invalid grant token: ${result.error}` })
    }

    if (result.claims?.grant_id !== id) {
      throw createProblemError({ status: 400, title: 'Grant ID in token does not match URL' })
    }

    const grant = await introspectGrant(id, stores.grantStore)
    if (!grant) {
      throw createProblemError({ status: 404, title: 'Grant not found' })
    }

    switch (grant.status) {
      case 'used':
        return { error: 'already_consumed', status: grant.status }
      case 'revoked':
        return { error: 'revoked', status: grant.status }
      case 'denied':
        return { error: 'denied', status: grant.status }
      case 'expired':
        return { error: 'expired', status: grant.status }
      case 'pending':
        return { error: 'not_approved', status: grant.status }
    }

    if (grant.request.grant_type === 'once') {
      const used = await useGrant(id, stores.grantStore)
      return { status: 'consumed', grant: used }
    }

    return { status: 'valid', grant }
  })
}

// --- Batch ---
interface BatchOperation {
  id: string
  action: 'approve' | 'deny' | 'revoke'
  grant_type?: GrantType
  duration?: number
}

interface BatchResult {
  id: string
  status: string
  success: boolean
  error?: ProblemDetails
}

export function createBatchGrantHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const email = requireManagementOrBearer(event, config, bearerPayload)

    const body = await readBody<{ operations: BatchOperation[] }>(event)

    if (!body?.operations || !Array.isArray(body.operations) || body.operations.length === 0) {
      throw createProblemError({ status: 400, title: 'Missing or empty operations array' })
    }

    const results: BatchResult[] = []
    let hasError = false

    for (const item of body.operations) {
      try {
        let grant
        switch (item.action) {
          case 'approve': {
            const overrides: ApproveGrantOverrides | undefined = item.grant_type
              ? { grant_type: item.grant_type, duration: item.duration }
              : undefined
            grant = await approveGrant(item.id, email, stores.grantStore, overrides)
            break
          }
          case 'deny':
            grant = await denyGrant(item.id, email, stores.grantStore)
            break
          case 'revoke':
            grant = await revokeGrant(item.id, stores.grantStore)
            break
          default:
            throw new Error(`Invalid action: ${(item as { action: string }).action}`)
        }
        results.push({ id: item.id, status: grant.status, success: true })
      }
      catch (err) {
        hasError = true
        results.push({
          id: item.id,
          status: 'error',
          success: false,
          error: {
            type: 'https://openape.org/errors/grant_already_decided',
            title: err instanceof Error ? err.message : 'Operation failed',
            status: 400,
          },
        })
      }
    }

    if (hasError) {
      setResponseStatus(event, 207)
    }

    return { results }
  })
}

// --- Verify AuthZ-JWT ---
export function createVerifyGrantHandler(stores: IdPStores, _config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const body = await readBody<{ token: string }>(event)

    if (!body?.token) {
      return { valid: false, error: 'Missing token' }
    }

    const signingKey = await stores.keyStore.getSigningKey()
    const result = await verifyAuthzJWT(body.token, {
      publicKey: signingKey.publicKey,
    })

    if (!result.valid) {
      return { valid: false, error: result.error }
    }

    const grantId = result.claims?.grant_id
    if (!grantId) {
      return { valid: false, error: 'Missing grant_id in token' }
    }

    const grant = await introspectGrant(grantId, stores.grantStore)
    if (!grant) {
      return { valid: false, error: 'Grant not found' }
    }

    if (grant.status !== 'approved') {
      return { valid: false, error: `Grant is not approved (status: ${grant.status})` }
    }

    if (grant.request.grant_type === 'once') {
      const used = await useGrant(grantId, stores.grantStore)
      return { valid: true, claims: result.claims, grant: used }
    }

    return { valid: true, claims: result.claims, grant }
  })
}
