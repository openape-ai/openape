import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { checks, monitors } from '../../database/schema'
import { loadOwnMonitor } from '../../utils/monitor-access'

/** DELETE /api/monitors/:id — remove a monitor and its history (owner only). */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const monitor = await loadOwnMonitor(event, caller)

  const db = useDb()
  await db.delete(checks).where(eq(checks.monitorId, monitor.id))
  await db.delete(monitors).where(eq(monitors.id, monitor.id))

  return { ok: true }
})
