import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { messages } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'

const bodySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
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
  const existing = await db.select().from(messages).where(eq(messages.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
  if (existing.senderEmail !== caller.email) {
    throw createError({ statusCode: 403, statusMessage: 'Can only edit own messages' })
  }

  const editedAt = Math.floor(Date.now() / 1000)
  await db
    .update(messages)
    .set({ body: parsed.data.body, editedAt })
    .where(eq(messages.id, id))

  return { ...existing, body: parsed.data.body, editedAt }
})
