import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { messages } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'
import { assertMember } from '../../../utils/membership'
import { broadcastToRoom } from '../../../utils/realtime'

const bodySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  reply_to: z.string().uuid().optional(),
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

  const message = {
    id: randomUUID(),
    roomId: id,
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
  return message
})
