import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { deals, notes } from '../../../database/schema'
import { parseNoteKind, parseNoteTitle } from '../../../utils/notes'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

const MAX_BODY = 5000

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const dealId = getRouterParam(event, 'id')!
  const input = await readBody<{ body?: string, title?: string, kind?: string }>(event)

  const text = input?.body?.trim()
  if (!text || text.length > MAX_BODY) {
    throw createProblemError({ status: 400, title: `body must be 1–${MAX_BODY} chars` })
  }
  let kind
  try {
    kind = parseNoteKind(input?.kind)
  }
  catch {
    throw createProblemError({ status: 400, title: 'unknown kind' })
  }
  const title = parseNoteTitle(input?.title)

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
    kind,
    title,
    body: text,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return { id, kind, title, body: text, author_email: caller.email, created_at: now }
})
