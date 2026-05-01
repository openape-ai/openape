import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { memberships } from '../../../../database/schema'
import { resolveCaller } from '../../../../utils/auth'
import { broadcastToRoom } from '../../../../utils/realtime'
import { requireRole } from '../../../../utils/room-access'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  const email = decodeURIComponent(getRouterParam(event, 'email') ?? '')
  if (!id || !email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing room id or email' })
  }

  await requireRole(id, caller.email, 'admin')

  // Self-removal guard: an admin cannot remove themselves. To leave the
  // room they'd have to ask another admin to do it (or use the user-facing
  // /api/rooms/:id/leave endpoint which is intentionally not gated by
  // admin role — but that's also the route a regular member uses to walk
  // out, and we don't want admins accidentally orphaning the room).
  if (email === caller.email) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot remove yourself. Ask another admin to do it.',
    })
  }

  const db = useDb()
  const result = await db
    .delete(memberships)
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, email)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found in room' })
  }

  await broadcastToRoom(id, {
    type: 'membership-removed',
    room_id: id,
    payload: { roomId: id, userEmail: email },
  })

  return { ok: true }
})
