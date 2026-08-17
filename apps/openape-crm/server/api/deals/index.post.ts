import { and, eq, sql } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { deals } from '../../database/schema'
import { isClosedStage, parseStage, parseTitle, parseValueCents } from '../../utils/deal-shape'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

interface Body {
  workspace_id?: string
  title?: string
  value_cents?: number
  stage?: string
  contact_id?: string | null
  org_id?: string | null
}

/** POST /api/deals — neuer Deal, ans Ende seiner Spalte. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<Body>(event)
  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email)

  const title = parseTitle(body?.title)
  const valueCents = parseValueCents(body?.value_cents)
  const stage = parseStage(body?.stage ?? 'lead')

  const last = await db
    .select({ max: sql<number | null>`max(${deals.position})` })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), eq(deals.stage, stage)))
    .get()

  const now = Date.now()
  const id = ulid()

  await db.insert(deals).values({
    id,
    workspaceId,
    title,
    valueCents,
    stage,
    contactId: body?.contact_id ?? null,
    orgId: body?.org_id ?? null,
    position: (last?.max ?? -1) + 1,
    createdBy: caller.email,
    createdAt: now,
    closedAt: isClosedStage(stage) ? now : null,
  })

  setResponseStatus(event, 201)
  return { id, title, value_cents: valueCents, stage, created_at: now }
})
