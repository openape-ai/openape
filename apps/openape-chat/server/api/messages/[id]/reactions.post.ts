import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { messages, reactions } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'
import { assertMember } from '../../../utils/membership'
import { broadcastToRoom } from '../../../utils/realtime'

const bodySchema = z.object({
  emoji: z.string().trim().min(1).max(32),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing message id' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  const target = await db.select().from(messages).where(eq(messages.id, id)).get()
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
  await assertMember(target.roomId, caller.email)

  const reaction = {
    messageId: id,
    userEmail: caller.email,
    emoji: parsed.data.emoji,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await db.insert(reactions).values(reaction).onConflictDoNothing()
  await broadcastToRoom(target.roomId, { type: 'reaction', room_id: target.roomId, payload: reaction })
  return reaction
})
