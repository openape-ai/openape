import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { memberships, rooms } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

// Room metadata for members only. Non-members get the same 404 a
// non-existent room id gets — by design: the room should be invisible
// to people who haven't been invited. Discovering rooms by guessing
// or by sharing a URL is not how membership happens; the creator adds
// members explicitly via the room-creation flow (or, later, an invite
// endpoint).
export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  const db = useDb()
  const m = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, caller.email)))
    .get()
  if (!m) {
    // Indistinguishable from "room doesn't exist" on purpose — non-members
    // shouldn't be able to confirm a room id even exists.
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }

  const room = await db.select().from(rooms).where(eq(rooms.id, id)).get()
  if (!room) {
    // Membership row pointing at a deleted room — treat as gone.
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }

  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    createdByEmail: room.createdByEmail,
    createdAt: room.createdAt,
    role: m.role,
  }
})
