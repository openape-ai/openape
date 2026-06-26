import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { projects } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'

/**
 * DELETE /api/projects/:id — soft-archive. Company owner or project manager.
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

  await db
    .update(projects)
    .set({ archivedAt: Math.floor(Date.now() / 1000) })
    .where(eq(projects.id, id))
    .run()

  setResponseStatus(event, 204)
  return null
})
