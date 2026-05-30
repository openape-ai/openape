import { eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents } from '../../../../database/schema'
import { requireAgent } from '../../../../utils/auth'
import { getOrCreateChat, listMessages } from '../../../../utils/chats'

// GET /api/agents/me/chat — the bridge bootstraps its session here.
// Returns the chat row (owner+agent pair) plus the most recent 50
// messages in chronological order. The bridge uses this to backfill
// history into its ThreadSession on (re)connect so the agent doesn't
// "forget" the conversation across restarts.

export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const db = useDb()
  const row = await db.select({ ownerEmail: agents.ownerEmail })
    .from(agents)
    .where(eq(agents.email, agentEmail))
    .limit(1)
  if (!row[0]) {
    throw createError({ statusCode: 404, statusMessage: 'agent not registered (run apes agents sync first)' })
  }
  const chat = await getOrCreateChat({ ownerEmail: row[0].ownerEmail, agentEmail })
  const recent = await listMessages({ chatId: chat.id, limit: 50 })
  return {
    chat,
    messages: recent.slice().reverse(),
  }
})
