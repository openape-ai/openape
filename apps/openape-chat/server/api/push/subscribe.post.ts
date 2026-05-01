import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

// Upsert the subscription. The endpoint URL is the natural primary key —
// it's stable per (browser, install) — so the same client re-subscribing
// (after token rotation, browser update, etc.) just updates its row.
export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const row = {
    endpoint: parsed.data.endpoint,
    userEmail: caller.email,
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
