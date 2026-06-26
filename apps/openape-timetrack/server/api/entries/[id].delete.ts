import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../database/drizzle'
import { timeEntries } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'
import { resolveEntryRights } from '../../utils/visibility'

/**
 * DELETE /api/entries/:id — soft-delete. Author, project manager, owner.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing entry id' })

  const db = useDb()
  const entry = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()
  if (!entry || entry.deletedAt) throw createProblemError({ status: 404, title: 'Entry not found' })

  const ctx = await resolveProjectContext(db, entry.projectId, caller.email)
  const { canEdit } = resolveEntryRights(caller.email, { userEmail: entry.userEmail }, {
    companyRole: ctx?.companyRole,
    projectRole: ctx?.projectRole,
  })
  if (!canEdit) throw createProblemError({ status: 403, title: 'No permission to delete this entry' })

  await db
    .update(timeEntries)
    .set({ deletedAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000), updatedBy: caller.email })
    .where(eq(timeEntries.id, id))
    .run()

  setResponseStatus(event, 204)
  return null
})
