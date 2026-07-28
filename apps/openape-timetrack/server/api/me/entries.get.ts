import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies, projects, timeEntries } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { serializeEntry } from '../../utils/entry-shape'
import { computeOverlaps } from '../../utils/overlap'

/**
 * GET /api/me/entries?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The caller's OWN time entries across every company/project in the date
 * range, enriched with project_name + company_name and an `overlap` flag
 * (true when its von/bis intersects another of the caller's entries —
 * warning only, never blocked).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event) as { from?: string, to?: string }
  if (!q.from || !q.to) {
    throw createProblemError({ status: 400, title: 'from and to (YYYY-MM-DD) required' })
  }

  const db = useDb()
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userEmail, caller.email),
      isNull(timeEntries.deletedAt),
      gte(timeEntries.entryDate, q.from),
      lte(timeEntries.entryDate, q.to),
    ))
    .all()

  const overlaps = computeOverlaps(
    rows.map(r => ({ id: r.id, startedAt: r.startedAt, endedAt: r.endedAt })),
  )

  const projIds = [...new Set(rows.map(r => r.projectId))]
  const compIds = [...new Set(rows.map(r => r.companyId))]
  const projName = new Map(
    projIds.length
      ? (await db.select({ id: projects.id, name: projects.name }).from(projects).all())
          .map(p => [p.id, p.name])
      : [],
  )
  const compName = new Map(
    compIds.length
      ? (await db.select({ id: companies.id, name: companies.name }).from(companies).all())
          .map(c => [c.id, c.name])
      : [],
  )

  return rows
    .sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : (a.startedAt ?? 0) - (b.startedAt ?? 0)))
    .map(r => ({
      ...serializeEntry(r),
      project_name: projName.get(r.projectId) ?? r.projectId,
      company_name: compName.get(r.companyId) ?? r.companyId,
      overlap: overlaps.has(r.id),
    }))
})
