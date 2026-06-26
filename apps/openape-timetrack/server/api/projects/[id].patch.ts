import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'

/**
 * PATCH /api/projects/:id — rename / set description / (un)archive.
 * Company owner OR project manager.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing project id' })

  const db = useDb()
  const project = await db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw createProblemError({ status: 404, title: 'Project not found' })

  const ctx = await resolveProjectContext(db, id, caller.email)
  const allowed = ctx && (ctx.companyRole === 'owner' || ctx.projectRole === 'manager')
  if (!allowed) throw createProblemError({ status: 403, title: 'Company owner or project manager only' })

  const body = await readBody<{ name?: string, description?: string, archived?: boolean }>(event)
  const patch: Partial<typeof projects.$inferInsert> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 120) throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
    patch.name = name
  }
  if (typeof body?.description === 'string') {
    if (body.description.length > 500) throw createProblemError({ status: 400, title: 'description must be ≤ 500 chars' })
    patch.description = body.description.trim()
  }
  if (typeof body?.archived === 'boolean') {
    patch.archivedAt = body.archived ? Math.floor(Date.now() / 1000) : null
  }
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'Nothing to update' })

  await db.update(projects).set(patch).where(eq(projects.id, id)).run()
  const u = await db.select().from(projects).where(eq(projects.id, id)).get()
  return {
    id: u!.id, company_id: u!.companyId, name: u!.name, description: u!.description,
    created_at: u!.createdAt, archived_at: u!.archivedAt,
  }
})
