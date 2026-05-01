import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'

const bodySchema = z.object({
  endpoint: z.string().url(),
})

// Owner-only revoke: an attacker who captured an endpoint URL shouldn't
// be able to silently unsubscribe someone else.
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  await db
    .delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.endpoint, parsed.data.endpoint),
      eq(pushSubscriptions.userEmail, email),
    ))

  return { ok: true }
})
