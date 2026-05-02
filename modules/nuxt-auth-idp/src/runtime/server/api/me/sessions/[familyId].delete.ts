import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { createProblemError } from '../../../utils/problem'
import { useIdpStores } from '../../../utils/stores'

/**
 * DELETE /api/me/sessions/[familyId] — revoke one of the caller's
 * refresh-token families. The other device that was using this family
 * will fail its next refresh with "Token family revoked" and the user
 * will need to `apes login` again on that device.
 *
 * Ownership-checked: a user can only revoke their own sessions even if
 * they know another user's familyId. Admin path is at
 * `/api/admin/sessions/[familyId]`.
 */
export default defineEventHandler(async (event) => {
  const callerEmail = await requireAuth(event)
  const familyId = getRouterParam(event, 'familyId') ?? ''
  if (!familyId) {
    throw createProblemError({ status: 400, title: 'familyId required' })
  }

  const { refreshTokenStore } = useIdpStores()
  // Verify ownership before revoking — the caller must own the family.
  const families = await refreshTokenStore.listFamilies({ userId: callerEmail, limit: 100 })
  const owned = families.data.find(f => f.familyId === familyId)
  if (!owned) {
    // 404 (not 403) so users can't probe for other users' familyIds.
    throw createProblemError({ status: 404, title: 'Session not found' })
  }

  await refreshTokenStore.revokeFamily(familyId)
  setResponseStatus(event, 204)
  return null
})
