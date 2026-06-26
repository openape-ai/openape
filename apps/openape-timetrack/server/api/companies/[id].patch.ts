import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveCompanyRole } from '../../utils/rbac'

/**
 * PATCH /api/companies/:id — rename or (un)archive. Company owner only.
 * Body: { name?: string, archived?: boolean }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing company id' })

  const db = useDb()
  const company = await db.select().from(companies).where(eq(companies.id, id)).get()
  if (!company) throw createProblemError({ status: 404, title: 'Company not found' })

  const role = await resolveCompanyRole(db, id, caller.email)
  if (role !== 'owner') throw createProblemError({ status: 403, title: 'Owner only' })

  const body = await readBody<{ name?: string, archived?: boolean }>(event)
  const patch: Partial<typeof companies.$inferInsert> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 120) throw createProblemError({ status: 400, title: 'name must be 1–120 chars' })
    patch.name = name
  }
  if (typeof body?.archived === 'boolean') {
    patch.archivedAt = body.archived ? Math.floor(Date.now() / 1000) : null
  }
  if (Object.keys(patch).length === 0) {
    throw createProblemError({ status: 400, title: 'Nothing to update' })
  }

  await db.update(companies).set(patch).where(eq(companies.id, id)).run()
  const updated = await db.select().from(companies).where(eq(companies.id, id)).get()
  return {
    id: updated!.id,
    name: updated!.name,
    role: 'owner' as const,
    created_at: updated!.createdAt,
    archived_at: updated!.archivedAt,
  }
})
