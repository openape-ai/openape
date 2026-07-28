import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { companies, companyMembers } from '../../database/schema'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/companies — create a company. Caller becomes `owner`.
 * Body: { name: string }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ name?: string }>(event)

  const name = body?.name?.trim()
  if (!name || name.length > 120) {
    throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
  }

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  const db = useDb()

  await db.insert(companies).values({ id, name, createdBy: caller.email, createdAt: now })
  await db.insert(companyMembers).values({
    companyId: id, userEmail: caller.email, role: 'owner', joinedAt: now,
  })

  setResponseStatus(event, 201)
  return { id, name, role: 'owner' as const, created_at: now, archived_at: null }
})
