import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { contacts, dealContacts, deals, organizations } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      value_cents: deals.valueCents,
      phase: deals.phase,
      stufe: deals.stufe,
      position: deals.position,
      contact_id: deals.contactId,
      contact_name: contacts.name,
      org_id: deals.orgId,
      org_name: organizations.name,
      created_at: deals.createdAt,
      closed_at: deals.closedAt,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(organizations, eq(organizations.id, deals.orgId))
    .where(eq(deals.workspaceId, workspaceId))
    .orderBy(asc(deals.position), asc(deals.createdAt))
    .all()

  const people = await db
    .select({
      deal_id: dealContacts.dealId,
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(dealContacts)
    .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
    .all()

  const byDeal = new Map<string, { id: string, name: string, email: string | null }[]>()
  for (const person of people) {
    const list = byDeal.get(person.deal_id) ?? []
    list.push({ id: person.id, name: person.name, email: person.email })
    byDeal.set(person.deal_id, list)
  }

  return rows.map(row => ({
    ...row,
    people: byDeal.get(row.id) ?? [],
  }))
})
