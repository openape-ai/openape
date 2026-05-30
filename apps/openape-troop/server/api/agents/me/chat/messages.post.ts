import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { agents } from '../../../../database/schema'
import { requireAgent } from '../../../../utils/auth'
import { appendMessage, getOrCreateChat } from '../../../../utils/chats'
import { broadcastToChat } from '../../../../utils/chat-realtime'

// POST /api/agents/me/chat/messages — agent's bridge posts a reply.
// Auth: agent JWT (act='agent', sub=agent email). The chat is resolved
// from the agent's own ownerEmail (looked up in the agents table) and
// the JWT sub.
//
// streaming=true → empty placeholder; bridge follows with PATCH calls
// to fill in body as deltas arrive, then PATCH streaming=false to flush.

const bodySchema = z.object({
  body: z.string().max(64 * 1024).default(''),
  streaming: z.boolean().optional(),
  streaming_status: z.string().max(256).nullable().optional(),
  reply_to: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  // Resolve the owner for this agent — agents table is the canonical
  // (agent.email → ownerEmail) map. An agent with no row here can't
  // post to troop chat; that's the same gate as `/api/agents/me/sync`.
  const db = useDb()
  const row = await db.select({ ownerEmail: agents.ownerEmail })
    .from(agents)
    .where(eq(agents.email, agentEmail))
    .limit(1)
  if (!row[0]) {
    throw createError({ statusCode: 404, statusMessage: 'agent not registered with troop (run apes agents sync first)' })
  }

  const chat = await getOrCreateChat({ ownerEmail: row[0].ownerEmail, agentEmail })
  const msg = await appendMessage({
    chatId: chat.id,
    role: 'agent',
    body: parsed.data.body,
    streaming: parsed.data.streaming ?? false,
    streamingStatus: parsed.data.streaming_status ?? null,
    replyTo: parsed.data.reply_to ?? null,
  })

  broadcastToChat(chat.id, {
    type: 'message',
    chat_id: chat.id,
    payload: msg as unknown as Record<string, unknown>,
  })

  return msg
})
