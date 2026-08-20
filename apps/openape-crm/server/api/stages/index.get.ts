import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { createProblemError } from '../../utils/problem'
import { listStages } from '../../utils/stages'
import { requireRole } from '../../utils/workspace-access'

/** GET /api/stages?workspace_id=… — die Pipeline des Workspaces, in Spaltenreihenfolge. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  return await listStages(db, workspaceId)
})
