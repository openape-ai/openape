import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { companies, projectMembers, projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveCompanyRole } from '../../utils/rbac'

/**
 * POST /api/projects — create a project under a company. Company owner only.
 * Caller is also added as project `manager`.
 * Body: { company_id: string, name: string, description?: string }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ company_id?: string, name?: string, description?: string }>(event)

  const companyId = body?.company_id?.trim()
  if (!companyId) throw createProblemError({ status: 400, title: 'company_id required' })
  const name = body?.name?.trim()
  if (!name || name.length > 120) throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
  const description = body?.description?.trim() ?? ''
  if (description.length > 500) throw createProblemError({ status: 400, title: 'description must be ≤ 500 chars' })

  const db = useDb()
  const company = await db.select().from(companies).where(eq(companies.id, companyId)).get()
  if (!company) throw createProblemError({ status: 404, title: 'Company not found' })

  const role = await resolveCompanyRole(db, companyId, caller.email)
  if (role !== 'owner') throw createProblemError({ status: 403, title: 'Company owner only' })

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  await db.insert(projects).values({
    id, companyId, name, description, createdBy: caller.email, createdAt: now,
  })
  await db.insert(projectMembers).values({
    projectId: id, userEmail: caller.email, role: 'manager', joinedAt: now,
  })

  setResponseStatus(event, 201)
  return {
    id, company_id: companyId, name, description,
    role: 'manager' as const, created_at: now, archived_at: null,
  }
})
