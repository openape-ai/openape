import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { pipelineStages, workspaceMembers, workspaces } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { defaultStageRows } from '../../utils/stages'

/** POST /api/workspaces — Workspace anlegen; der Aufrufer wird `owner`. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ name?: string }>(event)

  const name = body?.name?.trim()
  if (!name || name.length > 120) {
    throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
  }

  const now = Date.now()
  const id = ulid()
  const db = useDb()

  await db.insert(workspaces).values({ id, name, createdBy: caller.email, createdAt: now })
  await db.insert(workspaceMembers).values({
    workspaceId: id,
    userEmail: caller.email,
    role: 'owner',
    joinedAt: now,
  })
  await db.insert(pipelineStages).values(defaultStageRows(id))

  setResponseStatus(event, 201)
  return { id, name, role: 'owner' as const, created_at: now }
})
