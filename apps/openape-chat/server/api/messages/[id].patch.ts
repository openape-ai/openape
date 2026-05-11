import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { messages } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'
import { notifyRoomMembers } from '../../utils/push'
import { broadcastToRoom } from '../../utils/realtime'

// PATCH /api/messages/:id covers three distinct write paths against the
// same row, distinguished by the `streaming` field's current/incoming
// value:
//
//   1. Bridge stream-tick (streaming stays true): body update from the
//      chat-bridge as the LLM streams tokens. The agent's `body` grows
//      monotonically. We do NOT bump `edited_at` — these aren't human
//      edits, they're partial output of the in-flight turn.
//   2. Bridge stream-end (streaming flips true → false): final flush
//      from the bridge. The full body lands, streaming clears. Still
//      no `edited_at` bump (the message was never "complete" until
//      this PATCH; calling that an edit would be misleading).
//   3. Human edit (streaming already false): the sender goes back and
//      changes their own message. This bumps `edited_at` like before.
//
// Bridge also uses this endpoint to update `streaming_status` (a short
// "what is the agent currently doing" label — e.g. "🔧 time.now") so
// the UI can render a typing-subtitle without polluting the body.
const bodySchema = z.object({
  body: z.string().max(10_000).optional(),
  // Bridge clears this on stream-end; humans never set it.
  streaming: z.boolean().optional(),
  // null clears the status (e.g. tool finished); a string sets it.
  // Bridge writes; humans never read or set it.
  streaming_status: z.string().max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing message id' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }
  if (parsed.data.body === undefined && parsed.data.streaming === undefined && parsed.data.streaming_status === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'no fields to update' })
  }

  const db = useDb()
  const existing = await db.select().from(messages).where(eq(messages.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
  if (existing.senderEmail !== caller.email) {
    throw createError({ statusCode: 403, statusMessage: 'Can only edit own messages' })
  }

  // Reject body=empty unless the same call also keeps streaming=true
  // (placeholder state). Otherwise empty body means "I want to clear
  // the message", which we don't support — use a delete instead.
  if (parsed.data.body !== undefined && parsed.data.body.length === 0) {
    const willStayStreaming = (parsed.data.streaming ?? existing.streaming) === true
    if (!willStayStreaming) {
      throw createError({ statusCode: 400, statusMessage: 'body cannot be empty for completed messages' })
    }
  }

  // streaming flag mutations: only agents may toggle. Humans can't set
  // streaming=true on their own messages (that would skip edit-tracking).
  const incomingStreaming = parsed.data.streaming
  if (incomingStreaming !== undefined && caller.act !== 'agent') {
    throw createError({ statusCode: 403, statusMessage: 'streaming flag is agent-only' })
  }

  // Decide whether this PATCH counts as a human edit (= bump edited_at).
  // Path 1 + 2 (bridge stream tick / stream end) do NOT bump.
  // Path 3 (human edit on a completed message) DOES bump.
  const wasStreaming = existing.streaming === true
  const willStream = incomingStreaming ?? existing.streaming
  const isStreamingWrite = wasStreaming  // bridge is writing while message was in streaming state
  const editedAt = isStreamingWrite ? existing.editedAt : Math.floor(Date.now() / 1000)

  const updates: Record<string, unknown> = {}
  if (parsed.data.body !== undefined) updates.body = parsed.data.body
  if (incomingStreaming !== undefined) updates.streaming = willStream
  if (parsed.data.streaming_status !== undefined) updates.streamingStatus = parsed.data.streaming_status
  if (editedAt !== existing.editedAt) updates.editedAt = editedAt

  await db.update(messages).set(updates).where(eq(messages.id, id))

  const updated = {
    ...existing,
    ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
    ...(incomingStreaming !== undefined ? { streaming: willStream } : {}),
    ...(parsed.data.streaming_status !== undefined ? { streamingStatus: parsed.data.streaming_status } : {}),
    editedAt,
  }

  await broadcastToRoom(existing.roomId, { type: 'edit', room_id: existing.roomId, payload: updated })

  // Push fan-out: only on stream-end (was streaming, now not). The
  // initial POST suppresses push for streaming placeholders; this is
  // the canonical "agent is done typing, ping the human" trigger.
  // Skip for plain stream-tick patches and human edits.
  const justFinishedStreaming = wasStreaming && willStream === false
  if (justFinishedStreaming && updated.body && updated.body.length > 0) {
    void notifyRoomMembers(existing.roomId, caller.email, {
      title: caller.email,
      body: updated.body.length > 140 ? `${updated.body.slice(0, 140)}…` : updated.body,
      room_id: existing.roomId,
      thread_id: existing.threadId ?? undefined,
      sender: caller.email,
    })
  }

  return updated
})
