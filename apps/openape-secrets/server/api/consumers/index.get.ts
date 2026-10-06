import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { consumers } from '../../database/schema'
import { callerEmail } from '../../utils/access'

/** GET /api/consumers — the caller's own machines. */
export default defineEventHandler(async (event) => {
  const owner = await callerEmail(event)
  const rows = await useDb().select().from(consumers).where(eq(consumers.ownerEmail, owner))
  return rows.map(c => ({
    id: c.id,
    name: c.name,
    // The public key is public, but there is no reason to spray it around a
    // listing; the fill page fetches the one key it needs.
    allowed_requesters: JSON.parse(c.allowedRequesters) as string[],
    created_at: c.createdAt,
  }))
})
