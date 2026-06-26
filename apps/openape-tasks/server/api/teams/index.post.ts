import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { teamMembers, teams } from '../../database/schema'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/teams — create a new team. Caller becomes `owner`.
 *
 * Body: { name: string, description?: string, org_id?: string }
 * Response: { id, name, description, org_id, role: 'owner', created_at }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ name?: string, description?: string, org_id?: string }>(event)

  const name = body?.name?.trim()
  if (!name || name.length === 0 || name.length > 120) {
    throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
  }
  const description = body?.description?.trim() ?? null
  if (description && description.length > 500) {
    throw createProblemError({ status: 400, title: 'description must be ≤ 500 chars' })
  }
  const orgId = body?.org_id?.trim() || null
  if (orgId && orgId.length > 64) {
    throw createProblemError({ status: 400, title: 'org_id must be ≤ 64 chars' })
  }

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  const db = useDb()

  await db.insert(teams).values({
    id, name, description, orgId, createdBy: caller.email, createdAt: now,
  })
  await db.insert(teamMembers).values({
    teamId: id, userEmail: caller.email, role: 'owner', joinedAt: now,
  })

  setResponseStatus(event, 201)
  return {
    id,
    name,
    description,
    org_id: orgId,
    role: 'owner' as const,
    member_count: 1,
    open_task_count: 0,
    total_task_count: 0,
    archived_at: null,
    created_at: now,
    updated_at: now,
  }
})
