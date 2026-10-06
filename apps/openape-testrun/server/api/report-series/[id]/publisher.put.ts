import { defineEventHandler, getRouterParam } from 'h3'
import { useDatabaseClient } from '../../../database/drizzle'
import { row, transaction } from '../../../utils/html-store'
import { reportOwner } from '../../../utils/report-auth'
import { limitReportRequests, readReportBody } from '../../../utils/report-request'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  limitReportRequests(event)
  const principal = await reportOwner(event, 'reports:manage')
  const id = getRouterParam(event, 'id')!
  const { data } = await readReportBody(event)
  const body = data as { publisher?: unknown, expectedRevision?: unknown }
  if (!body || Object.keys(body).some(key => !['publisher', 'expectedRevision'].includes(key)) || !Number.isSafeInteger(body.expectedRevision)
    || (body.publisher !== null && (typeof body.publisher !== 'string' || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(body.publisher) || body.publisher.length > 300))) {
    throw createProblemError({ status: 400, title: 'Invalid publisher binding' })
  }
  return transaction(useDatabaseClient(), async (tx) => {
    const series = await row(tx, 'SELECT * FROM report_series WHERE id=? AND owner=?', [id, principal.subject])
    if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
    if (series.revision !== body.expectedRevision) throw createProblemError({ status: 409, title: 'Publisher binding changed; reload before editing' })
    const revision = Number(series.revision) + 1
    await tx.execute({ sql: 'UPDATE report_series SET publisher=?,revision=? WHERE id=?', args: [body.publisher as string | null, revision, id] })
    return { revision }
  })
})
