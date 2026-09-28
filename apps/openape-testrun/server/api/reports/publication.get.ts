import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { documentPublications, reportSeries, runs } from '../../database/schema'
import { privateReportHeaders, reportOwner, reportPublisher } from '../../utils/report-auth'
import { documentUrls } from '../../utils/document-response'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  privateReportHeaders(event)
  const query = getQuery(event)
  if (typeof query.key !== 'string' || !/^[\w:.-]{1,200}$/.test(query.key) || (query.seriesId !== undefined && typeof query.seriesId !== 'string')) throw createProblemError({ status: 400, title: 'Exact publication key required' })
  let owner: string; let publisher: string
  const db = useDb()
  if (typeof query.seriesId === 'string') {
    const series = await db.select().from(reportSeries).where(eq(reportSeries.id, query.seriesId)).get()
    if (!series) throw createProblemError({ status: 404, title: 'Report series not found' })
    publisher = await reportPublisher(event, series)
    owner = series.owner
  }
  else {
    const principal = await reportOwner(event, 'reports:publish')
    owner = principal.subject; publisher = principal.actor
  }
  const document = await db.select({ id: documentPublications.id, version: documentPublications.version, digest: documentPublications.digest, artifactDigest: documentPublications.artifactDigest, policyVersion: documentPublications.policyVersion, slug: runs.slug }).from(documentPublications).innerJoin(runs, eq(runs.id, documentPublications.id)).where(and(eq(documentPublications.owner, owner), publisher !== owner ? eq(documentPublications.publisher, publisher) : undefined, eq(documentPublications.idempotencyKey, query.key), typeof query.seriesId === 'string' ? eq(documentPublications.seriesId, query.seriesId) : undefined)).get()
  if (!document) throw createProblemError({ status: 404, title: 'Document not published' })
  return { ...document, ...documentUrls(event, document.slug) }
})
