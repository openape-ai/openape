import { eq } from 'drizzle-orm'
import { requireOwner } from '../../utils/auth'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'

// Store a browser's Web-Push subscription for the logged-in owner. Idempotent by
// endpoint (re-subscribe / owner switch overwrites the row).
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const body = await readBody<{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }>(event)
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth)
    throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })

  const db = useDb()
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint))
  await db.insert(pushSubscriptions).values({
    endpoint: body.endpoint,
    ownerEmail: owner,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    createdAt: Date.now(),
  })
  return { ok: true }
})
