import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { messages } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'
import { assertMember } from '../../../utils/membership'

const querySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  thread_id: z.string().uuid().optional(),
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
  // Phase B filter: when a thread_id is provided, scope to that thread;
  // otherwise return all room messages (back-compat). The webapp + CLI
  // pass the thread_id once they know which thread the user is viewing.
  const conds = [eq(messages.roomId, id)]
  if (parsed.data.thread_id) conds.push(eq(messages.threadId, parsed.data.thread_id))
  if (parsed.data.before) conds.push(lt(messages.createdAt, parsed.data.before))

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(desc(messages.createdAt))
    .limit(parsed.data.limit)

  // Return oldest-first so the client can append in order without reversing.
  return rows.reverse()
})
