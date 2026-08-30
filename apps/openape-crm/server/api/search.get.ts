import { eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { suche } from '#shared/search'
import { isPhase } from '#shared/pipelines'
import { useDb } from '../database/drizzle'
import { contacts, deals, notes, organizations } from '../database/schema'
import { createProblemError } from '../utils/problem'
import { requireRole } from '../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  const q = String(getQuery(event).q ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  const dealRows = await db.select().from(deals).where(eq(deals.workspaceId, workspaceId)).all()
  const noteRows = await db.select().from(notes).where(eq(notes.workspaceId, workspaceId)).all()
  const contactRows = await db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)).all()
  const orgRows = await db.select().from(organizations).where(eq(organizations.workspaceId, workspaceId)).all()
  const orgName = new Map(orgRows.map(o => [o.id, o.name]))
  const notesByDeal = new Map<string, string[]>()
  for (const n of noteRows) {
    const list = notesByDeal.get(n.dealId) ?? []
    list.push(`${n.title} ${n.body}`)
    notesByDeal.set(n.dealId, list)
  }
  const hits = suche(q, {
    vorgaenge: dealRows.map(d => ({
      id: d.id,
      titel: d.title,
      phase: isPhase(d.phase) ? d.phase : 'deal',
      stufe: d.stufe,
      firma: (d.orgId && orgName.get(d.orgId)) || '',
      personen: contactRows.filter(c => c.id === d.contactId).map(c => c.name),
      emails: contactRows.filter(c => c.id === d.contactId && c.email).map(c => c.email!),
      historie: notesByDeal.get(d.id) ?? [],
    })),
    personen: contactRows.map(c => ({ id: c.id, name: c.name, email: c.email || '' })),
    firmen: orgRows.map(o => ({ id: o.id, name: o.name, ort: o.city || o.domain || '' })),
  })

  return hits.map((hit) => {
    if (hit.typ === 'Vorgang') {
      const deal = dealRows.find(d => d.id === hit.id)
      return { ...hit, deal_id: hit.id, phase: deal?.phase }
    }
    if (hit.typ === 'Person') {
      const deal = dealRows.find(d => d.contactId === hit.id)
      return { ...hit, deal_id: deal?.id, phase: deal?.phase }
    }
    const deal = dealRows.find(d => d.orgId === hit.id)
    return { ...hit, deal_id: deal?.id, phase: deal?.phase }
  })
})
