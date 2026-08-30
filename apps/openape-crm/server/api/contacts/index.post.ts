import { and, eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { contactEmails, contactPhones, contacts, organizations } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

interface Body {
  workspace_id?: string
  name?: string
  email?: string
  phone?: string
  org_id?: string
}

/** POST /api/contacts — Kontakt anlegen, optional an eine Firma gehängt. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<Body>(event)
  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const name = body?.name?.trim()
  if (!name || name.length > 200) throw createProblemError({ status: 400, title: 'name must be 1–200 chars' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  // Eine Firma aus einem fremden Workspace darf hier nicht landen.
  if (body?.org_id) {
    const org = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, body.org_id), eq(organizations.workspaceId, workspaceId)))
      .get()
    if (!org) throw createProblemError({ status: 404, title: 'organization not found' })
  }

  const now = Date.now()
  const id = ulid()
  const email = body?.email?.trim().slice(0, 255) || null
  const phone = body?.phone?.trim().slice(0, 50) || null
  await db.insert(contacts).values({
    id,
    workspaceId,
    orgId: body?.org_id ?? null,
    name,
    email,
    phone,
    createdAt: now,
  })
  if (email) {
    await db.insert(contactEmails).values({ id: ulid(), contactId: id, email, position: 0 })
  }
  if (phone) {
    await db.insert(contactPhones).values({ id: ulid(), contactId: id, phone, position: 0 })
  }

  setResponseStatus(event, 201)
  return { id, name, email: body?.email ?? null, phone: body?.phone ?? null, org_id: body?.org_id ?? null, created_at: now }
})
