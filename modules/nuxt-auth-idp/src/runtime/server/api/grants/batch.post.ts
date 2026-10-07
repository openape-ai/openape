import type { GrantType, ProblemDetails } from '@openape/core'
import type { ApproveGrantOverrides } from '@openape/grants'
import { approveGrant, denyGrant, revokeGrant } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { requireAuth } from '../../utils/admin'
import type { GrantAction } from '../../utils/grant-authority'
import { requireGrantActionAuthority } from '../../utils/grant-authority'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

const GRANT_ACTIONS: GrantAction[] = ['approve', 'deny', 'revoke']

interface BatchOperation {
  id: string
  action: GrantAction
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
  const email = await requireAuth(event)
  const body = await readBody<{ operations: BatchOperation[] }>(event)

  if (!body?.operations || !Array.isArray(body.operations) || body.operations.length === 0) {
    throw createProblemError({ status: 400, title: 'Missing or empty operations array' })
  }

  const { grantStore } = useGrantStores()
  const results: BatchResult[] = []
  let hasError = false

  for (const item of body.operations) {
    try {
      if (!GRANT_ACTIONS.includes(item.action)) throw new Error(`Invalid action: ${item.action}`)
      const existing = await grantStore.findById(item.id)
      if (!existing) throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
      await requireGrantActionAuthority(event, existing, email, item.action)
      let grant
      switch (item.action) {
        case 'approve': {
          const overrides: ApproveGrantOverrides | undefined = item.grant_type
            ? { grant_type: item.grant_type, duration: item.duration }
            : undefined
          grant = await approveGrant(item.id, email, grantStore, overrides)
          break
        }
        case 'deny':
          grant = await denyGrant(item.id, email, grantStore)
          break
        case 'revoke':
          grant = await revokeGrant(item.id, grantStore)
          break
      }
      results.push({ id: item.id, status: grant.status, success: true })
    }
    catch (err) {
      hasError = true
      results.push({
        id: item.id,
        status: 'error',
        success: false,
        error: toProblemDetails(err),
      })
    }
  }

  if (hasError) {
    setResponseStatus(event, 207)
  }

  return { results }
})

function toProblemDetails(err: unknown): ProblemDetails {
  if (err && typeof err === 'object' && 'statusCode' in err && 'data' in err) return err.data as ProblemDetails
  return {
    type: 'https://openape.org/errors/grant_already_decided',
    title: err instanceof Error ? err.message : 'Operation failed',
    status: 400,
  }
}
