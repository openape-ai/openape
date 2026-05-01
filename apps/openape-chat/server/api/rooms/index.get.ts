import { eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { memberships, rooms } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const db = useDb()

  const result = await db
    .select({
      id: rooms.id,
      name: rooms.name,
      kind: rooms.kind,
      createdByEmail: rooms.createdByEmail,
      createdAt: rooms.createdAt,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(rooms, eq(memberships.roomId, rooms.id))
    .where(eq(memberships.userEmail, caller.email))

  return result
})
