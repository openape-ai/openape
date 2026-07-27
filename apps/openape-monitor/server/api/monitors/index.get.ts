import { desc, eq, inArray, sql } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { checks, monitors } from '../../database/schema'

/** GET /api/monitors — the caller's monitors with current status + uptime%. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()

  const rows = await db.select().from(monitors).where(eq(monitors.ownerEmail, caller.email)).orderBy(desc(monitors.createdAt))

  // Uptime over retained history, one grouped query for all of the caller's monitors.
  const ids = rows.map(r => r.id)
  const uptime = new Map<string, { total: number, ups: number }>()
  if (ids.length) {
    const stats = await db.select({
      monitorId: checks.monitorId,
      total: sql<number>`count(*)`,
      ups: sql<number>`sum(${checks.up})`,
    }).from(checks).where(inArray(checks.monitorId, ids)).groupBy(checks.monitorId)
    for (const s of stats) uptime.set(s.monitorId, { total: s.total, ups: s.ups ?? 0 })
  }

  return rows.map((m) => {
    const u = uptime.get(m.id)
    return {
      id: m.id,
      name: m.name,
      url: m.url,
      interval_sec: m.intervalSec,
      status: m.lastStatus,
      last_code: m.lastCode,
      last_latency_ms: m.lastLatencyMs,
      last_error: m.lastError,
      last_checked_at: m.lastCheckedAt,
      uptime_pct: u && u.total > 0 ? Math.round((u.ups / u.total) * 1000) / 10 : null,
      checks_count: u?.total ?? 0,
      created_at: m.createdAt,
    }
  })
})
