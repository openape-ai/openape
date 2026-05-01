import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { memberships } from '../database/schema'

export type RoomRole = 'member' | 'admin'

/**
 * Resolve the caller's role in a room. Throws 404 for non-members so the
 * UI sees the same response as for non-existent rooms — non-members
 * shouldn't be able to confirm a room exists. Throws 403 when an admin
 * action is required and the caller is only a regular member.
 */
export async function requireRole(
  roomId: string,
  email: string,
  required: 'member' | 'admin' = 'member',
): Promise<RoomRole> {
  const db = useDb()
  const m = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.roomId, roomId), eq(memberships.userEmail, email)))
    .get()
  if (!m) {
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }
  if (required === 'admin' && m.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  return m.role as RoomRole
}
