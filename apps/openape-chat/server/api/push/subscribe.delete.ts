import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'

const bodySchema = z.object({
  endpoint: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  // Owner check: only the subscriber can revoke. Otherwise an attacker who
  // captured an endpoint URL could delete it for someone else (annoying,
  // not a privilege escalation, but still avoidable).
  const db = useDb()
  await db
    .delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.endpoint, parsed.data.endpoint),
      eq(pushSubscriptions.userEmail, caller.email),
    ))

  return { ok: true }
})
