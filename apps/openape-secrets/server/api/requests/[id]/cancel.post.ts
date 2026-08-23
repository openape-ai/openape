import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretRequests } from '../../../database/schema'
import { callerEmail } from '../../../utils/access'
import { createProblemError } from '../../../utils/problem'
import { toRequestView } from '../../../utils/request-view'

/**
 * POST /api/requests/:id/cancel — the owner declines.
 *
 * Refusing has to be exactly as easy as complying. A gate whose only obvious
 * button is "hand it over" trains people to hand things over.
 */
export default defineEventHandler(async (event) => {
  const caller = await callerEmail(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'id required' })

  const row = await useDb().select().from(secretRequests).where(eq(secretRequests.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'Request not found' })
  if (row.ownerEmail !== caller) throw createProblemError({ status: 403, title: 'Not your request' })
  if (row.status !== 'requested') throw createProblemError({ status: 409, title: `Request is already ${row.status}` })

  await useDb().update(secretRequests).set({ status: 'cancelled' }).where(eq(secretRequests.id, id))
  return toRequestView({ ...row, status: 'cancelled' })
})
