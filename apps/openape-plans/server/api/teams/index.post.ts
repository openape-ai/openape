import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { teamMembers, teams } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/teams — create a new team. Caller becomes `owner`.
 *
 * Body: { name: string, description?: string }
 * Response: { id, name, description, role: 'owner', created_at }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ name?: string, description?: string }>(event)

  const name = body?.name?.trim()
  if (!name || name.length === 0 || name.length > 120) {
    throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
  }
  const description = body?.description?.trim() ?? null
  if (description && description.length > 500) {
    throw createProblemError({ status: 400, title: 'description must be ≤ 500 chars' })
  }

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  const db = useDb()

  await db.insert(teams).values({
    id, name, description, createdBy: caller.email, createdAt: now,
  })
  await db.insert(teamMembers).values({
    teamId: id, userEmail: caller.email, role: 'owner', joinedAt: now,
  })

  setResponseStatus(event, 201)
  return {
    id,
    name,
    description,
    role: 'owner' as const,
    member_count: 1,
    plan_count: 0,
    archived_at: null,
    created_at: now,
    updated_at: now,
  }
})
