import type { GrantType } from '@openape/core'
import { createDelegation, revokeGrant, validateDelegation } from '@openape/grants'
import { defineEventHandler, getQuery, getRouterParam, readBody, setResponseStatus } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { verifyBearerAuth } from '../utils/bearer-auth.js'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

function requireHumanBearer(payload: { sub: string, act: string } | null): string {
  if (!payload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  if (payload.act !== 'human') {
    throw createProblemError({ status: 403, title: 'Only human users may create delegations' })
  }
  return payload.sub
}

function requireBearer(payload: { sub: string } | null): string {
  if (!payload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  return payload.sub
}

// --- Create Delegation ---
export function createCreateDelegationHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const delegator = requireHumanBearer(bearerPayload)

    const body = await readBody(event)

    if (!body?.delegate || typeof body.delegate !== 'string') {
      throw createProblemError({ status: 400, title: 'Missing delegate' })
    }
    if (!body?.audience || typeof body.audience !== 'string') {
      throw createProblemError({ status: 400, title: 'Missing audience' })
    }

    const grantType = body.grant_type || 'once'
    if (!VALID_GRANT_TYPES.includes(grantType)) {
      throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
    }

    if (grantType === 'timed' && (!body.duration || typeof body.duration !== 'number')) {
      throw createProblemError({ status: 400, title: 'Duration is required for timed grants' })
    }

    const grant = await createDelegation({
      delegator,
      delegate: body.delegate,
      audience: body.audience,
      scopes: Array.isArray(body.scopes) ? body.scopes : undefined,
      grant_type: grantType,
      duration: typeof body.duration === 'number' ? body.duration : undefined,
    }, stores.grantStore)

    setResponseStatus(event, 201)
    return grant
  })
}

// --- List Delegations ---
export function createListDelegationsHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const email = requireBearer(bearerPayload)

    const query = getQuery(event)
    const role = query.role as string | undefined
    const search = query.search as string | undefined
    const cursor = query.cursor as string | undefined
    const queryLimit = query.limit ? Number(query.limit) : undefined

    const grantStore = stores.grantStore

    let delegations: import('@openape/core').OpenApeGrant[]

    if (role === 'delegator') {
      if (!grantStore.findByDelegator) {
        throw createProblemError({ status: 501, title: 'Delegation queries not supported by this store' })
      }
      delegations = await grantStore.findByDelegator(email)
    }
    else if (role === 'delegate') {
      if (!grantStore.findByDelegate) {
        throw createProblemError({ status: 501, title: 'Delegation queries not supported by this store' })
      }
      delegations = await grantStore.findByDelegate(email)
    }
    else {
      // No role filter: return all delegations for this user (as delegator or delegate)
      const [asDelegator, asDelegate] = await Promise.all([
        grantStore.findByDelegator ? grantStore.findByDelegator(email) : [],
        grantStore.findByDelegate ? grantStore.findByDelegate(email) : [],
      ])

      const seen = new Set<string>()
      delegations = []
      for (const grant of [...asDelegator, ...asDelegate]) {
        if (!seen.has(grant.id)) {
          seen.add(grant.id)
          delegations.push(grant)
        }
      }
    }

    // Sort by created_at DESC
    delegations.sort((a, b) => b.created_at - a.created_at)

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      delegations = delegations.filter(g =>
        g.request.delegator?.toLowerCase().includes(q)
        || g.request.delegate?.toLowerCase().includes(q)
        || g.request.audience?.toLowerCase().includes(q),
      )
    }

    // Cursor pagination (cursor = grant ID)
    if (cursor) {
      const idx = delegations.findIndex(g => g.id === cursor)
      if (idx >= 0) delegations = delegations.slice(idx + 1)
    }

    const limit = Math.min(Math.max(queryLimit ?? 50, 1), 100)
    const hasMore = delegations.length > limit
    const data = delegations.slice(0, limit)

    return {
      data,
      pagination: {
        cursor: data.length > 0 ? data.at(-1)!.id : null,
        has_more: hasMore,
      },
    }
  })
}

// --- Revoke Delegation ---
export function createRevokeDelegationHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    const email = requireBearer(bearerPayload)

    const id = getRouterParam(event, 'id')
    if (!id) {
      throw createProblemError({ status: 400, title: 'Missing delegation ID' })
    }

    const grant = await stores.grantStore.findById(id)
    if (!grant || grant.type !== 'delegation') {
      throw createProblemError({ status: 404, title: 'Delegation not found' })
    }

    // Only the delegator can revoke their own delegation
    if (grant.request.delegator !== email) {
      throw createProblemError({ status: 403, title: 'Not authorized to revoke this delegation' })
    }

    try {
      const revoked = await revokeGrant(id, stores.grantStore)
      return revoked
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke delegation'
      throw createProblemError({ status: 400, title: message })
    }
  })
}

// --- Validate Delegation ---
export function createValidateDelegationHandler(stores: IdPStores, _config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    if (!id) {
      throw createProblemError({ status: 400, title: 'Missing delegation ID' })
    }

    const body = await readBody<{ delegate: string, audience: string }>(event)
    if (!body?.delegate || !body?.audience) {
      throw createProblemError({ status: 400, title: 'Missing delegate or audience' })
    }

    try {
      const grant = await validateDelegation(id, body.delegate, body.audience, stores.grantStore)
      return {
        valid: true,
        delegation: grant,
        scopes: grant.request.scopes || [],
      }
    }
    catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Delegation validation failed',
      }
    }
  })
}
