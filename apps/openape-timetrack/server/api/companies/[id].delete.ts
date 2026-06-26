import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { companies } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveCompanyRole } from '../../utils/rbac'

/**
 * DELETE /api/companies/:id — soft-archive the company. Owner only.
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

  await db
    .update(companies)
    .set({ archivedAt: Math.floor(Date.now() / 1000) })
    .where(eq(companies.id, id))
    .run()

  setResponseStatus(event, 204)
  return null
})
