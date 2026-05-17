import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../database/drizzle'
import { clearAdminCache, isRootAdmin } from '../../../utils/admin-claim'

/**
 * Bust the in-memory admin cache for the caller and re-resolve from
 * scratch. Useful right after the user pastes their secret into DNS
 * — they don't want to wait for the negative TTL to expire before
 * the UI shows their new admin status.
 */
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  clearAdminCache(email)

  const issuer = useRuntimeConfig().openapeIdp.issuer as string
  const isRoot = await isRootAdmin(useDb(), issuer, email)
  return { isRoot }
})
