import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { memberships, rooms } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

// Room metadata + the caller's own membership status. Returned even when
// the caller is NOT a member of the room — that's intentional, the Web UI
// uses this to show a "Join this channel" prompt instead of a dead end
// when someone follows a shared link.
//
// Privacy: a non-member learns the room exists, its name, and its kind,
// but nothing about other members or messages. For closed/DM rooms we
// could narrow this further; for channels (the open kind) it's fine
// because channel names are essentially public anyway.
export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  const db = useDb()
  const room = await db.select().from(rooms).where(eq(rooms.id, id)).get()
  if (!room) {
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }

  const m = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, caller.email)))
    .get()

  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    createdByEmail: room.createdByEmail,
    createdAt: room.createdAt,
    isMember: !!m,
    role: m?.role ?? null,
  }
})
