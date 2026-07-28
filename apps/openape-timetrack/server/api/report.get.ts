import { and, eq, inArray, isNull } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../database/drizzle'
import { projects, timeEntries } from '../database/schema'
import { createProblemError } from '../utils/problem'
import { loadCallerRoleMaps } from '../utils/rbac'
import { resolveEntryRights } from '../utils/visibility'

type GroupBy = 'project' | 'type' | 'user' | 'day'
const GROUPS = new Set<GroupBy>(['project', 'type', 'user', 'day'])

/**
 * GET /api/report?company=&project=&from=&to=&by= — aggregated totals over
 * the entries the caller may see. Totals separated total vs billable.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event) as {
    company?: string
    project?: string
    from?: string
    to?: string
    by?: string
  }
  const by = (q.by ?? 'project') as GroupBy
  if (!GROUPS.has(by)) throw createProblemError({ status: 400, title: 'by must be project|type|user|day' })

  const db = useDb()
  const maps = await loadCallerRoleMaps(db, caller.email)

  const filters = [isNull(timeEntries.deletedAt)]
  if (q.project) filters.push(eq(timeEntries.projectId, q.project))
  else if (q.company) filters.push(eq(timeEntries.companyId, q.company))

  const rows = await db.select().from(timeEntries).where(and(...filters)).all()

  const buckets = new Map<string, { total_minutes: number, billable_minutes: number, break_minutes: number, entries: number }>()
  let total = 0
  let billable = 0
  let breakTotal = 0

  for (const r of rows) {
    if (q.from && r.entryDate < q.from) continue
    if (q.to && r.entryDate > q.to) continue
    const { canView } = resolveEntryRights(caller.email, { userEmail: r.userEmail }, {
      companyRole: maps.companyRoles.get(r.companyId),
      projectRole: maps.projectRoles.get(r.projectId),
    })
    if (!canView) continue

    const key = by === 'project'
      ? r.projectId
      : by === 'type'
        ? r.type
        : by === 'user' ? r.userEmail : r.entryDate

    const b = buckets.get(key) ?? { total_minutes: 0, billable_minutes: 0, break_minutes: 0, entries: 0 }
    if (r.isBreak) {
      b.break_minutes += r.durationMinutes
      breakTotal += r.durationMinutes
    }
    else {
      b.total_minutes += r.durationMinutes
      total += r.durationMinutes
      if (r.billable) {
        b.billable_minutes += r.durationMinutes
        billable += r.durationMinutes
      }
    }
    b.entries += 1
    buckets.set(key, b)
  }

  // Human label per group key. Only `project` needs a lookup (key is a ULID);
  // type/user/day keys are already human-readable.
  const labels = new Map<string, string>()
  if (by === 'project' && buckets.size > 0) {
    const rows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, [...buckets.keys()]))
      .all()
    for (const p of rows) labels.set(p.id, p.name)
  }

  return {
    by,
    // total_minutes = work only (breaks excluded); break_minutes separate.
    total_minutes: total,
    billable_minutes: billable,
    break_minutes: breakTotal,
    groups: [...buckets.entries()]
      .map(([key, v]) => ({ key, label: labels.get(key) ?? key, ...v }))
      .sort((a, b) => b.total_minutes - a.total_minutes),
  }
})
