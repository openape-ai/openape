import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

// Upsert by endpoint. The browser may re-subscribe (after token rotation,
// browser update, etc.) with the same endpoint URL — we don't want a new
// row each time, just refreshed keys.
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const row = {
    endpoint: parsed.data.endpoint,
    userEmail: email,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const db = useDb()
  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userEmail: row.userEmail,
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: row.createdAt,
      },
    })

  return { ok: true }
})
