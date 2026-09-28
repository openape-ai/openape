import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { documentPublications, runs } from '../../database/schema'
import { reportOwner } from '../../utils/report-auth'
import { reportCategory } from '../../utils/document-shape'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const principal = await reportOwner(event)
  const query = getQuery(event)
  if (query.category !== undefined && (typeof query.category !== 'string' || !/^[a-f0-9]{64}$/.test(query.category))) throw createProblemError({ status: 400, title: 'Invalid category key' })
  const limit = query.limit === undefined ? 50 : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw createProblemError({ status: 400, title: 'Invalid pagination' })
  const label = sql<string>`CASE WHEN ${runs.reportType} = 'briefing' THEN 'Briefings' WHEN ${runs.reportType} = 'test' THEN 'Test Runs' ELSE COALESCE(${documentPublications.category}, 'Uncategorized') END`
  const key = sql<string>`CASE WHEN ${runs.reportType} = 'briefing' THEN ${reportCategory('Briefings').key} WHEN ${runs.reportType} = 'test' THEN ${reportCategory('Test Runs').key} ELSE COALESCE(${documentPublications.categoryKey}, ${reportCategory('Uncategorized').key}) END`
  const accessible = and(eq(runs.createdBy, principal.subject), isNull(runs.deletedAt))
  const db = useDb()
  const categories = await db.select({ key, label: sql<string>`MIN(${label})`, count: sql<number>`count(*)` }).from(runs).leftJoin(documentPublications, eq(documentPublications.id, runs.id)).where(accessible).groupBy(key).orderBy(label)
  const reports = await db.select({ id: runs.id, slug: runs.slug, title: runs.title, type: runs.reportType, visibility: runs.visibility, category: label, categoryKey: key, createdAt: runs.createdAt, version: runs.version }).from(runs).leftJoin(documentPublications, eq(documentPublications.id, runs.id)).where(and(accessible, typeof query.category === 'string' ? eq(key, query.category) : undefined)).orderBy(desc(runs.createdAt), desc(runs.id)).limit(limit).offset(offset)
  return { categories, reports, total: categories.reduce((total, item) => total + item.count, 0), limit, offset }
})
