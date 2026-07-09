import { randomUUID } from 'node:crypto'
import { useDb } from '../../database/drizzle'
import { cockpitServices } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'
import { normalizeServiceUrl } from '../../utils/cockpit/services'

// Register an external sp-tasks service the reactive loop should co-tend.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const body = await readBody<{ baseUrl?: string, tasksPath?: string, label?: string }>(event)
  const { baseUrl, host } = normalizeServiceUrl(String(body?.baseUrl ?? ''))
  const tasksPath = body?.tasksPath && body.tasksPath.startsWith('/') ? body.tasksPath : '/api/agent/tasks'
  const label = (body?.label ?? '').trim() || host
  const row = { id: randomUUID(), ownerEmail: owner, baseUrl, tasksPath, label, enabled: true, createdAt: Date.now() }
  await useDb().insert(cockpitServices).values(row)
  return { id: row.id, baseUrl, tasksPath, label, enabled: true }
})
