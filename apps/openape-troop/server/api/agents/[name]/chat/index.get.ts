import { requireOwner } from '../../../../utils/auth'
import { getChatForAgentName, listMessages } from '../../../../utils/chats'

// GET /api/agents/<name>/chat — the chat row + last page of messages.
// One persistent session per (owner, agent). UI uses this to bootstrap
// the chat tab; subsequent inserts arrive via the WS subscription
// (server/routes/_ws/chat.ts).
//
// The chat row is created lazily — the first GET against an agent the
// owner has never chatted with returns an empty messages list and a
// fresh chat id.

export default defineEventHandler(async (event) => {
  const ownerEmail = await requireOwner(event)
  const agentName = getRouterParam(event, 'name')
  if (!agentName) throw createError({ statusCode: 400, statusMessage: 'Missing agent name' })

  const chat = await getChatForAgentName(ownerEmail, agentName)
  if (!chat) throw createError({ statusCode: 404, statusMessage: `agent ${agentName} not found for this owner` })

  // Recent messages first → reverse for chronological display.
  const recent = await listMessages({ chatId: chat.id, limit: 50 })
  return {
    chat,
    messages: recent.slice().reverse(),
  }
})
