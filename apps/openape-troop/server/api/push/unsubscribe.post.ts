import { eq } from 'drizzle-orm'
import { requireOwner } from '../../utils/auth'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<{ endpoint?: string }>(event)
  if (body?.endpoint)
    await useDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint))
  return { ok: true }
})
