import type { ProblemDetails } from '@openape/core'
import { approveGrant, denyGrant, revokeGrant } from '@openape/grants'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { requireAuth } from '../../utils/admin'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

interface BatchOperation {
  id: string
  action: 'approve' | 'deny' | 'revoke'
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
      let grant
      switch (item.action) {
        case 'approve':
          grant = await approveGrant(item.id, email, grantStore)
          break
        case 'deny':
          grant = await denyGrant(item.id, email, grantStore)
          break
        case 'revoke':
          grant = await revokeGrant(item.id, grantStore)
          break
        default:
          throw new Error(`Invalid action: ${item.action}`)
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
