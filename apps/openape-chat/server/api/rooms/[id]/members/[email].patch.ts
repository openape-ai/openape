import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { memberships } from '../../../../database/schema'
import { resolveCaller } from '../../../../utils/auth'
import { broadcastToRoom } from '../../../../utils/realtime'
import { requireRole } from '../../../../utils/room-access'

const bodySchema = z.object({
  role: z.enum(['member', 'admin']),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  const email = decodeURIComponent(getRouterParam(event, 'email') ?? '')
  if (!id || !email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing room id or email' })
  }

  await requireRole(id, caller.email, 'admin')

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  // Self-demotion guard: an admin cannot demote themselves to member.
  // (They'd have to ask another admin.) This avoids a room ending up with
  // zero admins by accident.
  if (email === caller.email && parsed.data.role !== 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot demote yourself. Ask another admin to do it.',
    })
  }

  const db = useDb()
  const result = await db
    .update(memberships)
    .set({ role: parsed.data.role })
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, email)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found in room' })
  }

  await broadcastToRoom(id, {
    type: 'membership-changed',
    room_id: id,
    payload: { roomId: id, userEmail: email, role: parsed.data.role },
  })

  return result[0]
})
