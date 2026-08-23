import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { secretRequests } from '../../../database/schema'
import { callerEmail } from '../../../utils/access'
import { createProblemError } from '../../../utils/problem'

/**
 * POST /api/requests/:id/collect — the machine picks up its envelope.
 *
 * Handing it over and destroying it are the same operation. The alternative,
 * marking it as read, would leave a copy of every secret ever passed through
 * sitting in the database forever; the point of a gate is that nothing stays
 * in it.
 *
 * The envelope is useless without the consumer's private key, so this endpoint
 * is guarded by ownership rather than by the key itself: whoever holds the key
 * runs on the machine, and the machine authenticates as its owner. Secrecy
 * rests on the key; one-shot collection is what stops a replay.
 */
export default defineEventHandler(async (event) => {
  const caller = await callerEmail(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'id required' })

  const db = useDb()
  const row = await db.select().from(secretRequests).where(eq(secretRequests.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'Request not found' })
  if (row.ownerEmail !== caller) throw createProblemError({ status: 403, title: 'Not your request' })

  if (row.status === 'fetched') {
    throw createProblemError({
      status: 410,
      title: 'Already collected',
      detail: 'The envelope was handed over once and destroyed. Raise a new request.',
    })
  }
  if (row.status !== 'filled') {
    throw createProblemError({ status: 409, title: `Request is ${row.status}, nothing to collect` })
  }

  const box = { epk: row.boxEpk!, salt: row.boxSalt!, iv: row.boxIv!, ct: row.boxCt! }

  // Destroy first, hand over second. If the write fails the caller gets an
  // error and can retry; if it succeeded but the response never arrived, the
  // secret is gone and a new request is needed. Losing a secret is recoverable,
  // leaving one behind is not.
  await db.update(secretRequests).set({
    status: 'fetched',
    boxEpk: null,
    boxSalt: null,
    boxIv: null,
    boxCt: null,
    fetchedAt: Math.floor(Date.now() / 1000),
  }).where(eq(secretRequests.id, id))

  return { id: row.id, field_name: row.fieldName, box }
})
