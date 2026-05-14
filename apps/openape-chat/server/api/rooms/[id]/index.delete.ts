import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { memberships, messages, reactions, rooms, threads } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

// DELETE /api/rooms/:id — wipe the room and everything that points
// at it. Members-only: any current member can delete; non-members get
// the same 404 they'd see for "room doesn't exist". For DM rooms
// (the only kind we create) that's the two participants — either
// can nuke the conversation from their end.
//
// What gets deleted:
//   - reactions where message_id ∈ this room's messages
//   - messages (rows scoped by room_id)
//   - threads (scoped by room_id)
//   - memberships (both rows, scoped by room_id)
//   - the room itself
//
// Contacts stay intact. The contact-row is what represents "I know
// this person"; the room is just where chats happen. Deleting one
// chat doesn't unfriend — the next time either side opens the
// thread, `ensureDmRoomFor` will provision a fresh room. The history
// stays gone, but the relationship survives.
//
// No soft-delete (yet): two-person DMs, deleting from one side wipes
// for both. The semantic is "I'm done with this conversation, let
// it disappear" not "archive". If we want personal-only deletes
// later (each side has their own copy), this endpoint changes to
// drop the caller's membership + leave the room intact for the
// peer; that's a follow-up if anyone asks.
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
    // Same "indistinguishable from non-existent" pattern as GET — no
    // information leak about other tenants' room ids.
    throw createError({ statusCode: 404, statusMessage: 'Room not found' })
  }

  // Reactions reference message_id, not room_id directly — collect the
  // ids first so we can filter the reactions delete by them.
  const msgIds = (await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.roomId, id))
  ).map(r => r.id)

  if (msgIds.length > 0) {
    // Drizzle's SQLite driver chokes on giant IN-lists; we have
    // plenty of headroom here (room-sized message counts, rarely
    // > a few thousand) so a single delete is fine. Chunk if it
    // ever bites.
    await db.delete(reactions).where(inArray(reactions.messageId, msgIds))
  }
  await db.delete(messages).where(eq(messages.roomId, id))
  await db.delete(threads).where(eq(threads.roomId, id))
  await db.delete(memberships).where(eq(memberships.roomId, id))
  await db.delete(rooms).where(eq(rooms.id, id))

  return { ok: true }
})
