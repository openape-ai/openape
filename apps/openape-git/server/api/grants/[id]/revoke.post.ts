import { revokeGrant } from '@openape/grants'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useGrantStore } from '../../../utils/grant-store'

/**
 * POST /api/grants/:id/revoke — the delegator takes access back. The git
 * transport re-checks grants on every request, so the very next fetch is 403.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id') ?? ''

  const store = useGrantStore()
  const grant = await store.findById(id)
  if (!grant || grant.request.delegator !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'grant not found' })
  if (grant.status !== 'approved' && grant.status !== 'pending')
    throw createError({ statusCode: 409, statusMessage: `grant is ${grant.status}` })

  return revokeGrant(id, store)
})
