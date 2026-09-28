import { defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { reportSeries } from '../../../database/schema'
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
  const db = useDb()
  const series = await db.select().from(reportSeries).where(and(eq(reportSeries.id, id), eq(reportSeries.owner, principal.subject))).get()
  if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
  const updated = await db.update(reportSeries).set({ publisher: body.publisher as string | null, revision: series.revision + 1 }).where(and(eq(reportSeries.id, id), eq(reportSeries.revision, body.expectedRevision as number))).returning({ revision: reportSeries.revision }).get()
  if (!updated) throw createProblemError({ status: 409, title: 'Publisher binding changed; reload before editing' })
  return updated
})
