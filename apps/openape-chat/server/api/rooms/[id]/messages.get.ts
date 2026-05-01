import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { messages } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'
import { assertMember } from '../../../utils/membership'

const querySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })

  await assertMember(id, caller.email)

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  const where = parsed.data.before
    ? and(eq(messages.roomId, id), lt(messages.createdAt, parsed.data.before))
    : eq(messages.roomId, id)

  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.createdAt))
    .limit(parsed.data.limit)

  // Return oldest-first so the client can append in order without reversing.
  return rows.reverse()
})
