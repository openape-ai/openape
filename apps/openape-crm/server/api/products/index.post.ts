import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { products } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{
    workspace_id?: string
    name?: string
    description?: string
    standard_price_cents?: number
    standard_billing?: string
  }>(event)
  const workspaceId = body?.workspace_id
  const name = body?.name?.trim()
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  if (!name || name.length > 200) throw createProblemError({ status: 400, title: 'name must be 1–200 chars' })
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  const id = ulid()
  await db.insert(products).values({
    id,
    workspaceId,
    name,
    description: body?.description?.trim() || null,
    standardPriceCents: Number.isInteger(body?.standard_price_cents) ? body.standard_price_cents! : 0,
    standardBilling: body?.standard_billing || 'monatlich',
    createdAt: Date.now(),
  })
  setResponseStatus(event, 201)
  return { id, name }
})
