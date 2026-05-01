import { eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { memberships } from '../../../../database/schema'
import { resolveCaller } from '../../../../utils/auth'
import { requireRole } from '../../../../utils/room-access'

// Members of a room can list the other members. Non-members get the
// same 404 they get for the room itself.
export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  await requireRole(id, caller.email, 'member')

  const db = useDb()
  return await db
    .select({
      userEmail: memberships.userEmail,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .where(eq(memberships.roomId, id))
})
