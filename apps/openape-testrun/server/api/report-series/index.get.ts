import { defineEventHandler } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { reportSeries, runs } from '../../database/schema'
import { reportOwner } from '../../utils/report-auth'

export default defineEventHandler(async (event) => {
  const principal = await reportOwner(event)
  return await useDb().select({ id: reportSeries.id, name: reportSeries.name, slug: reportSeries.slug, publisher: reportSeries.publisher, revision: reportSeries.revision, version: runs.version, createdAt: runs.createdAt }).from(reportSeries).leftJoin(runs, and(eq(runs.id, reportSeries.id), isNull(runs.deletedAt))).where(eq(reportSeries.owner, principal.subject)).limit(100)
})
