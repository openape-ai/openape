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
  // Empty body allowed only when `streaming: true` is set — the bridge
  // posts a placeholder before the LLM has produced any tokens.
  body: z.string().max(10_000),
  reply_to: z.string().uuid().optional(),
  // Optional in v1: when omitted, the message lands in the room's main
  // thread (auto-created on first use). Phase-B-aware clients pass the
  // active thread id explicitly.
  thread_id: z.string().uuid().optional(),
  // Mark the message as "currently being streamed by the agent". The
  // chat-bridge sets this when it posts the empty placeholder, then
  // patches body+streaming=false on stream-end. While streaming=true
  // the PATCH handler updates body without bumping edited_at, so the
  // chat UI doesn't show "(edited)" on every chunk.
  streaming: z.boolean().optional(),
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

  // Streaming is only meaningful from the agent side. Humans don't
  // partial-send messages, and allowing humans to set streaming=true
  // would let them bypass edit-tracking on their own messages.
  const streaming = parsed.data.streaming === true && caller.act === 'agent'

  if (parsed.data.body.length === 0 && !streaming) {
    throw createError({ statusCode: 400, statusMessage: 'body cannot be empty unless streaming=true' })
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
    streaming,
    streamingStatus: null as string | null,
  }

  const db = useDb()
  await db.insert(messages).values(message)

  await broadcastToRoom(id, { type: 'message', room_id: id, payload: message })

  // Web-Push fan-out for offline / installed clients. Best-effort and async
  // — we don't block the REST response on push delivery, and the helper
  // silently no-ops if VAPID isn't configured (dev environments).
  //
  // Don't push the placeholder while streaming — it's empty or "…" and
  // would just bonk the device for nothing. The final PATCH (streaming
  // → false) is responsible for triggering the user-visible push.
  if (!streaming && parsed.data.body.length > 0) {
    void notifyRoomMembers(id, caller.email, {
      title: caller.email,
      body: parsed.data.body.length > 140 ? `${parsed.data.body.slice(0, 140)}…` : parsed.data.body,
      room_id: id,
      thread_id: threadId,
      sender: caller.email,
    })
  }

  return message
})
