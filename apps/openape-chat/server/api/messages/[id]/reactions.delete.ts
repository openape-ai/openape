import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { reactions } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

const querySchema = z.object({
  emoji: z.string().trim().min(1).max(32),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing message id' })

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  await db
    .delete(reactions)
    .where(and(
      eq(reactions.messageId, id),
      eq(reactions.userEmail, caller.email),
      eq(reactions.emoji, parsed.data.emoji),
    ))

  return { ok: true }
})
