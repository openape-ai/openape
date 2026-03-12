import { introspectGrant, useGrant, verifyAuthzJWT } from '@openape/grants'
import { defineEventHandler, getHeader, getRouterParam } from 'h3'
import { useGrantStores } from '../../../utils/grant-stores'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

/**
 * POST /api/grants/:id/consume
 *
 * Called by apes before command execution. Verifies the grant JWT,
 * checks the grant is still valid, and consumes it for `once` grants.
 *
 * Authorization: Bearer <grant-jwt>
 *
 * Returns:
 * - 200 { status: "consumed" } — once grant consumed
 * - 200 { status: "valid" } — timed/always grant still active
 * - 403 { error: "already_consumed" } — once grant already used
 * - 403 { error: "revoked" } — grant was revoked
 * - 403 { error: "expired" } — timed grant expired
 * - 403 { error: "denied" } — grant was denied
 * - 401 — invalid JWT
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  // Extract JWT from Authorization header
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createProblemError({ status: 401, title: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)

  // Verify JWT signature
  const { keyStore } = useIdpStores()
  const signingKey = await keyStore.getSigningKey()
  const result = await verifyAuthzJWT(token, {
    publicKey: signingKey.publicKey,
  })

  if (!result.valid) {
    throw createProblemError({ status: 401, title: `Invalid grant token: ${result.error}`, type: 'https://openape.org/errors/invalid_authz_jwt' })
  }

  // Verify grant_id in JWT matches URL parameter
  if (result.claims?.grant_id !== id) {
    throw createProblemError({ status: 400, title: 'Grant ID in token does not match URL' })
  }

  // Look up grant and check status
  const { grantStore } = useGrantStores()
  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // Check grant status
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

  // Grant is approved — consume for once grants
  if (grant.request.grant_type === 'once') {
    const used = await useGrant(id, grantStore)
    return { status: 'consumed', grant: used }
  }

  // timed/always: just validate, don't consume
  return { status: 'valid', grant }
})
