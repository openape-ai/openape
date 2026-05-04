import { eq } from 'drizzle-orm'
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

// Subscribe to push notifications for the authenticated user.
//
// Re-subscribing the SAME endpoint URL refreshes the keys (browsers
// rotate the encryption keys on their own schedule). Subscribing an
// endpoint that's already bound to a DIFFERENT user is rejected (#296)
// — without that check, user A could submit user B's endpoint URL and
// `onConflictDoUpdate` would silently transfer ownership, hijacking
// every future notification from B's device.
export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const db = useDb()
  const existing = await db
    .select({ userEmail: pushSubscriptions.userEmail })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint))
    .get()

  if (existing && existing.userEmail !== email) {
    // Endpoint claimed by someone else — refuse, don't leak who.
    throw createError({
      statusCode: 409,
      statusMessage: 'Push endpoint is already registered to a different account',
    })
  }

  const row = {
    endpoint: parsed.data.endpoint,
    userEmail: email,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    createdAt: Math.floor(Date.now() / 1000),
  }

  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // userEmail intentionally NOT in the SET clause — the existing
        // row is either ours (matched the pre-check) or doesn't exist.
        // Keeping it out of SET defends against any future race where
        // a row appears between the pre-check and the insert.
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: row.createdAt,
      },
    })

  return { ok: true }
})
