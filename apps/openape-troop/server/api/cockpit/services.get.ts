import { eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitServices } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'

// The owner's registered external services (in addition to troop's own cockpit).
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const db = useDb()
  const rows = await db.select().from(cockpitServices).where(eq(cockpitServices.ownerEmail, owner))
  return rows.map(r => ({ id: r.id, baseUrl: r.baseUrl, tasksPath: r.tasksPath, label: r.label, enabled: r.enabled }))
})
