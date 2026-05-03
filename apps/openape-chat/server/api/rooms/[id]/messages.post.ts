import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { messages } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'
import { assertMember } from '../../../utils/membership'
import { notifyRoomMembers } from '../../../utils/push'
import { broadcastToRoom } from '../../../utils/realtime'
import { ensureMainThread, findThreadById } from '../../../utils/threads'

const bodySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  reply_to: z.string().uuid().optional(),
  // Optional in v1: when omitted, the message lands in the room's main
  // thread (auto-created on first use). Phase-B-aware clients pass the
  // active thread id explicitly.
  thread_id: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  await assertMember(id, caller.email)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  // Resolve thread: explicit thread_id (validated to belong to this
  // room) OR fall back to the room's main thread (lazy-create for
  // legacy rooms).
  let threadId: string
  if (parsed.data.thread_id) {
    const thread = await findThreadById(parsed.data.thread_id)
    if (!thread || thread.roomId !== id) {
      throw createError({ statusCode: 400, statusMessage: 'thread_id does not belong to this room' })
    }
    if (thread.archivedAt) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot post to an archived thread' })
    }
    threadId = thread.id
  }
  else {
    const main = await ensureMainThread({ roomId: id, createdByEmail: caller.email })
    threadId = main.id
  }

  const message = {
    id: randomUUID(),
    roomId: id,
    threadId,
    senderEmail: caller.email,
    senderAct: caller.act,
    body: parsed.data.body,
    replyTo: parsed.data.reply_to ?? null,
    createdAt: Math.floor(Date.now() / 1000),
    editedAt: null as number | null,
  }

  const db = useDb()
  await db.insert(messages).values(message)

  await broadcastToRoom(id, { type: 'message', room_id: id, payload: message })

  // Web-Push fan-out for offline / installed clients. Best-effort and async
  // — we don't block the REST response on push delivery, and the helper
  // silently no-ops if VAPID isn't configured (dev environments).
  void notifyRoomMembers(id, caller.email, {
    title: caller.email,
    body: parsed.data.body.length > 140 ? `${parsed.data.body.slice(0, 140)}…` : parsed.data.body,
    room_id: id,
    sender: caller.email,
  })

  return message
})
