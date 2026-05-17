import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { memberships } from '../database/schema'

export async function assertMember(roomId: string, email: string) {
  const db = useDb()
  const m = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.roomId, roomId), eq(memberships.userEmail, email)))
    .get()
  if (!m) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this room' })
  }
  return m
}
