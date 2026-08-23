import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { consumers, secretRequests } from '../../database/schema'
import { callerEmail } from '../../utils/access'
import { createProblemError } from '../../utils/problem'
import { isLapsed, toRequestView } from '../../utils/request-view'

/**
 * GET /api/requests/:id — what the fill page needs: who asked, for what, why,
 * and the consumer's public key to seal against.
 *
 * Two people may read it: the owner who has to fill it, and the requester who
 * is waiting. Anyone else gets 403 — the id alone must not be a capability,
 * because ids travel in links and logs.
 */
export default defineEventHandler(async (event) => {
  const caller = await callerEmail(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'id required' })

  const row = await useDb().select().from(secretRequests).where(eq(secretRequests.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'Request not found' })
  if (row.ownerEmail !== caller && row.requester !== caller) {
    throw createProblemError({ status: 403, title: 'Not your request' })
  }

  const view = toRequestView(row)
  const nowSec = Math.floor(Date.now() / 1000)
  // Report the truth about a lapsed request even before anything sweeps it,
  // so the fill page never invites someone to seal a value nobody can collect.
  if (isLapsed(row, nowSec)) view.status = 'expired'

  // Only the person who fills needs the key to seal against.
  if (caller !== row.ownerEmail) return view
  const consumer = await useDb().select().from(consumers).where(eq(consumers.id, row.consumerId)).get()
  return {
    ...view,
    consumer_name: consumer?.name ?? null,
    consumer_public_key_jwk: consumer ? JSON.parse(consumer.publicKeyJwk) as Record<string, unknown> : null,
  }
})
