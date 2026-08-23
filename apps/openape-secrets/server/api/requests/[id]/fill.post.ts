import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretRequests } from '../../../database/schema'
import { callerEmail } from '../../../utils/access'
import { createProblemError } from '../../../utils/problem'
import { isCompleteBox } from '../../../utils/box'
import { isLapsed, toRequestView } from '../../../utils/request-view'

/**
 * POST /api/requests/:id/fill — the owner hands over a sealed value.
 *
 * The plaintext never reaches this handler; it was sealed in the browser
 * against the consumer's public key. What arrives is four base64 strings that
 * this service cannot combine into anything readable.
 */
export default defineEventHandler(async (event) => {
  const caller = await callerEmail(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'id required' })

  const row = await useDb().select().from(secretRequests).where(eq(secretRequests.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'Request not found' })
  // Only the person the request is addressed to. The requester may watch the
  // status but must never be able to supply the value it will later collect.
  if (row.ownerEmail !== caller) throw createProblemError({ status: 403, title: 'Not your request' })

  const nowSec = Math.floor(Date.now() / 1000)
  if (isLapsed(row, nowSec)) {
    throw createProblemError({ status: 410, title: 'Request expired', detail: 'Sealing a value nobody can collect would be worse than refusing.' })
  }
  if (row.status !== 'requested') {
    // A gate you can fill twice is not a gate: the second value would silently
    // replace one the consumer may already be relying on.
    throw createProblemError({ status: 409, title: `Request is already ${row.status}` })
  }

  const box = (await readBody<{ box?: unknown }>(event))?.box
  if (!isCompleteBox(box)) {
    throw createProblemError({ status: 400, title: 'box must carry epk, salt, iv and ct' })
  }

  await useDb().update(secretRequests).set({
    status: 'filled',
    boxEpk: box.epk,
    boxSalt: box.salt,
    boxIv: box.iv,
    boxCt: box.ct,
    filledAt: nowSec,
  }).where(eq(secretRequests.id, id))

  return toRequestView({ ...row, status: 'filled', filledAt: nowSec })
})
