import type { GrantType, ProblemDetails } from '@openape/core'
import type { ApproveGrantOverrides } from '@openape/grants'
import { approveGrant, denyGrant, revokeGrant } from '@openape/grants'
import { verifyBearerAuth } from '../../utils/bearer-auth'
import { hasManagementToken } from '../../utils/admin-auth'

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

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

  // Determine identity: management token or bearer
  let email: string
  if (hasManagementToken(event, config)) {
    email = '_management_'
  }
  else if (bearerPayload) {
    email = bearerPayload.sub
  }
  else {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }

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
