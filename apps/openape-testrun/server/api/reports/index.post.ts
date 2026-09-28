import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { eq } from 'drizzle-orm'
import { useDatabaseClient, useDb } from '../../database/drizzle'
import { reportSeries } from '../../database/schema'
import { privateReportHeaders, reportOwner, reportPublisher } from '../../utils/report-auth'
import { limitReportRequests, readReportBody } from '../../utils/report-request'
import { validateBriefing } from '../../utils/briefing-shape'
import { publishBriefing } from '../../utils/report-store'
import { briefingUrls } from '../../utils/report-urls'
import { createProblemError } from '../../utils/problem'
import { documentBodyLimit, validateDocument } from '../../utils/document-shape'
import { publishDocument } from '../../utils/document-store'
import { documentUrls, requireDocumentPublishing } from '../../utils/document-response'

export default defineEventHandler(async (event) => {
  privateReportHeaders(event)
  limitReportRequests(event)
  const key = getHeader(event, 'idempotency-key')
  if (!key || !/^[\w:.-]{1,200}$/.test(key)) throw createProblemError({ status: 400, title: 'Idempotency-Key required' })
  const { raw, data } = await readReportBody(event, documentBodyLimit)
  if (data && typeof data === 'object' && 'type' in data && data.type === 'document') {
    requireDocumentPublishing()
    const document = validateDocument(data)
    let owner: string; let publisher: string
    if (document.seriesId) {
      const series = await useDb().select().from(reportSeries).where(eq(reportSeries.id, document.seriesId)).get()
      if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
      publisher = await reportPublisher(event, series)
      owner = series.owner
    }
    else {
      const principal = await reportOwner(event, 'reports:publish')
      owner = principal.subject
      publisher = principal.actor
    }
    const result = await publishDocument(useDatabaseClient(), document, raw, owner, publisher, key)
    setResponseStatus(event, result.replayed ? 200 : 201)
    return { ...result, ...documentUrls(event, result.slug) }
  }
  if (Buffer.byteLength(raw) > 60 * 1024) throw createProblemError({ status: 413, title: 'Briefing exceeds 60 KiB' })
  const briefing = validateBriefing(data)
  const series = await useDb().select().from(reportSeries).where(eq(reportSeries.id, briefing.seriesId)).get()
  if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
  const publisher = await reportPublisher(event, series)
  const result = await publishBriefing(useDatabaseClient(), briefing, raw, publisher, key)
  setResponseStatus(event, result.replayed ? 200 : 201)
  return { ...result, ...briefingUrls(event, result.slug, result.version) }
})
