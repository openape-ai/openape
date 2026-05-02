import { defineEventHandler, getQuery } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'

/**
 * GET /api/me/sessions — list refresh-token families belonging to the
 * caller. Each family corresponds to one `apes login` (one device); they
 * rotate their refresh tokens independently and are revoked individually.
 *
 * Auth: any authenticated caller (cookie session OR Bearer JWT) — we
 * filter by `userId` so users only see their own sessions, never anyone
 * else's. Admin endpoint at `/api/admin/sessions` covers the cross-user
 * listing path.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const query = getQuery(event)
  const limit = query.limit ? Number(query.limit) : undefined
  const cursor = query.cursor as string | undefined

  const { refreshTokenStore } = useIdpStores()
  return await refreshTokenStore.listFamilies({ userId, limit, cursor })
})
