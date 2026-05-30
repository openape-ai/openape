import { z } from 'zod'
import { requireOwner } from '../../../../utils/auth'
import { appendMessage, getChatForAgentName } from '../../../../utils/chats'
import { broadcastToChat } from '../../../../utils/chat-realtime'

// POST /api/agents/<name>/chat/messages — owner sends a message to the
// agent. Writes the human-role row, broadcasts a `message` frame to
// every WS peer subscribed to the chat (including the agent's bridge).
// The bridge picks the frame up, runs its LLM loop, posts the agent's
// reply via a separate POST (or PATCH-streams it via the bridge WS).

const bodySchema = z.object({
  body: z.string().min(1).max(64 * 1024),
  reply_to: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const ownerEmail = await requireOwner(event)
  const agentName = getRouterParam(event, 'name')
  if (!agentName) throw createError({ statusCode: 400, statusMessage: 'Missing agent name' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const chat = await getChatForAgentName(ownerEmail, agentName)
  if (!chat) throw createError({ statusCode: 404, statusMessage: `agent ${agentName} not found for this owner` })

  const msg = await appendMessage({
    chatId: chat.id,
    role: 'human',
    body: parsed.data.body,
    replyTo: parsed.data.reply_to ?? null,
  })

  broadcastToChat(chat.id, {
    type: 'message',
    chat_id: chat.id,
    payload: msg as unknown as Record<string, unknown>,
  })

  return msg
})
