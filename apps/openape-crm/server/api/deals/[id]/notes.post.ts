import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { deals, notes } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

const MAX_BODY = 5000

/** POST /api/deals/:id/notes — append a note. Body: { body: string } */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const dealId = getRouterParam(event, 'id')!
  const input = await readBody<{ body?: string }>(event)

  const text = input?.body?.trim()
  if (!text || text.length > MAX_BODY) {
    throw createProblemError({ status: 400, title: `body must be 1–${MAX_BODY} chars` })
  }

  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)

  const now = Date.now()
  const id = ulid()
  await db.insert(notes).values({
    id,
    workspaceId: deal.workspaceId,
    dealId,
    authorEmail: caller.email,
    body: text,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return { id, body: text, author_email: caller.email, created_at: now }
})
