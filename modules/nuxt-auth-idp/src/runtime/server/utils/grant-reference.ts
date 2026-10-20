import type { BrokeredGrant, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { assertGrantBatchMember, assertGrantReferenceRequest, assertSameReferencedGrant, grantReferenceKey, GrantReferenceConflictError, InvalidGrantBatchError, InvalidGrantReferenceError } from '@openape/grants'
import { useGrantStores } from './grant-stores'
import { runGrantPendingHooks } from './grant-pending-hooks'
import { createProblemError } from './problem'

/** Reading or creating a reference never issues a token or consumes permission. */
export async function requestReferencedGrant(request: OpenApeGrantRequest, brokered?: BrokeredGrant): Promise<{ grant: OpenApeGrant, created: boolean }> {
  const { grantStore } = useGrantStores()
  try {
    assertGrantReferenceRequest(request)
    if (!request.reference) throw new InvalidGrantReferenceError('A reference is required')
    if (!grantStore.createReferenced) throw createProblemError({ status: 501, title: 'This store does not support grant references' })
    const candidate: OpenApeGrant = { id: crypto.randomUUID(), type: 'command', request, status: 'pending', created_at: Math.floor(Date.now() / 1000), ...(brokered ? { brokered } : {}) }
    const { data } = await grantStore.listGrants({ referenceKey: grantReferenceKey(request.requester, request.reference, brokered), limit: 1 })
    if (data[0]) {
      assertSameReferencedGrant(data[0], candidate)
      return { grant: data[0], created: false }
    }
    await assertGrantBatchMember(request, grantStore)
    // The read above only preserves original presentation on retries. The store
    // enforces uniqueness and binding equality atomically, including concurrent creates.
    const result = await grantStore.createReferenced(candidate)
    if (result.created) await runGrantPendingHooks(result.grant)
    return result
  }
  catch (error) {
    if (error instanceof GrantReferenceConflictError) throw createProblemError({ status: 409, title: error.message })
    if (error instanceof InvalidGrantReferenceError || error instanceof InvalidGrantBatchError) throw createProblemError({ status: 400, title: error.message })
    throw error
  }
}
