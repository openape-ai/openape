import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { memberships } from '../../../../database/schema'
import { resolveCaller } from '../../../../utils/auth'
import { broadcastToRoom } from '../../../../utils/realtime'
import { requireRole } from '../../../../utils/room-access'

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['member', 'admin']).default('member'),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  await requireRole(id, caller.email, 'admin')

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const row = {
    roomId: id,
    userEmail: parsed.data.email,
    role: parsed.data.role,
    joinedAt: Math.floor(Date.now() / 1000),
  }

  const db = useDb()
  await db
    .insert(memberships)
    .values(row)
    .onConflictDoUpdate({
      target: [memberships.roomId, memberships.userEmail],
      set: { role: row.role },
    })

  await broadcastToRoom(id, {
    type: 'membership-added',
    room_id: id,
    payload: row,
  })

  return row
})
