import { defineEventHandler, getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { reportPublications, reportSeries } from '../../../../../database/schema'
import { privateReportHeaders, reportPublisher } from '../../../../../utils/report-auth'
import { briefingUrls } from '../../../../../utils/report-urls'
import { limitReportRequests } from '../../../../../utils/report-request'
import { createProblemError } from '../../../../../utils/problem'

export default defineEventHandler(async (event) => {
  privateReportHeaders(event)
  limitReportRequests(event)
  const id = getRouterParam(event, 'id')!
  const date = getRouterParam(event, 'date')!
  const db = useDb()
  const series = await db.select().from(reportSeries).where(eq(reportSeries.id, id)).get()
  if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
  await reportPublisher(event, series)
  const publication = await db.select({ id: reportPublications.id, digest: reportPublications.digest, version: reportPublications.version }).from(reportPublications).where(and(eq(reportPublications.seriesId, id), eq(reportPublications.editionDate, date))).get()
  if (!publication) throw createProblemError({ status: 404, title: 'Edition not published' })
  return { ...publication, ...briefingUrls(event, series.slug, publication.version) }
})
