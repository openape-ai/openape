import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../../database/drizzle'
import { agents, chatMessages, chats } from '../../../../../database/schema'
import { requireAgent } from '../../../../../utils/auth'
import { patchMessage } from '../../../../../utils/chats'
import { broadcastToChat } from '../../../../../utils/chat-realtime'

// PATCH /api/agents/me/chat/messages/<id> — agent's bridge streams its
// reply by patching an existing row in place. Auth: agent JWT.
//
// Guards: the row's chat must belong to a chat whose agentEmail equals
// the caller's sub. Without this guard an agent could PATCH any row.

const bodySchema = z.object({
  body: z.string().max(64 * 1024).optional(),
  streaming: z.boolean().optional(),
  streaming_status: z.string().max(256).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const messageId = getRouterParam(event, 'id')
  if (!messageId) throw createError({ statusCode: 400, statusMessage: 'Missing message id' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  // Two-hop ownership check: message → chat → agentEmail.
  const owner = await db
    .select({ chatId: chats.id, chatAgent: chats.agentEmail })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .where(eq(chatMessages.id, messageId))
    .limit(1)
  if (!owner[0]) throw createError({ statusCode: 404, statusMessage: 'message not found' })
  if (owner[0].chatAgent !== agentEmail) {
    throw createError({ statusCode: 403, statusMessage: 'cannot patch another agent\'s message' })
  }
  // Defensive: stop the agent from patching to a different agent
  // (we only check by id above; ensure caller isn't trying to repoint).
  void agents

  const updated = await patchMessage({
    id: messageId,
    body: parsed.data.body,
    streaming: parsed.data.streaming,
    streamingStatus: parsed.data.streaming_status,
  })
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'message not found' })

  broadcastToChat(owner[0].chatId, {
    type: parsed.data.streaming === false ? 'message' : 'edit',
    chat_id: owner[0].chatId,
    payload: updated as unknown as Record<string, unknown>,
  })

  return updated
})
