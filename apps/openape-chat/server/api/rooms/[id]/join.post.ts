import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { memberships, rooms } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing room id' })
  }

  const db = useDb()
  const room = await db.select().from(rooms).where(eq(rooms.id, id)).get()
  if (!room) {
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }

  // DMs are closed groups — joining must go through `/api/rooms` (POST) with
  // explicit members; you can't self-join a DM.
  if (room.kind === 'dm') {
    throw createError({ statusCode: 403, statusMessage: 'DMs are not joinable; create a new DM via POST /api/rooms with members' })
  }

  await db.insert(memberships).values({
    roomId: id,
    userEmail: caller.email,
    role: 'member',
    joinedAt: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing()

  return await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, caller.email)))
    .get()
})
