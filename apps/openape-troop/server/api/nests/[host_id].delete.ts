import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { nests } from '../../database/schema'
import { requireOwnerWithScope } from '../../utils/auth'

// DELETE /api/nests/:host_id — revoke a device binding (M4δ).
//
// Soft-revoke: flips status to 'revoked' rather than deleting the row,
// so the binding stays auditable and an in-flight token referencing the
// host_id resolves to a revoked row (→ 403 at the bind-grant check in
// M4δ-3) instead of a missing one. Gated by `nest:bind` — revoking a
// binding is the same authority as creating one.
export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnerWithScope(event, 'nest:bind')
  const hostId = getRouterParam(event, 'host_id')
  if (!hostId) {
    throw createError({ statusCode: 400, statusMessage: 'host_id required' })
  }

  const db = useDb()
  const updated = await db
    .update(nests)
    .set({ status: 'revoked' })
    .where(and(
      eq(nests.ownerEmail, owner.toLowerCase()),
      eq(nests.hostId, hostId),
    ))
    .returning({ hostId: nests.hostId })

  if (!updated[0]) {
    throw createError({ statusCode: 404, statusMessage: 'nest not found' })
  }
  return { host_id: updated[0].hostId, status: 'revoked' }
})
