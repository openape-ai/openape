import { eq, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'
import { contacts, deals } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

/** DELETE /api/contacts/:id — Deals bleiben bestehen, verlieren nur die Verknüpfung. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!

  const db = useDb()
  const contact = await db.select().from(contacts).where(eq(contacts.id, id)).get()
  if (!contact) throw createProblemError({ status: 404, title: 'contact not found' })
  await requireRole(db, contact.workspaceId, caller.email)

  await db.update(deals).set({ contactId: sql`NULL` }).where(eq(deals.contactId, id))
  await db.delete(contacts).where(eq(contacts.id, id))
  return { deleted: true }
})
