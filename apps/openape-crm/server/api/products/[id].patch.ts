import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { products } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{
    name?: string
    description?: string | null
    standard_price_cents?: number
    standard_billing?: string
  }>(event)
  const db = useDb()
  const row = await db.select().from(products).where(eq(products.id, id)).get()
  if (!row) throw createProblemError({ status: 404, title: 'product not found' })
  await requireRole(db, row.workspaceId, caller.email)
  const patch: Partial<typeof products.$inferInsert> = {}
  if (body?.name !== undefined) {
    const name = body.name.trim()
    if (!name || name.length > 200) throw createProblemError({ status: 400, title: 'name must be 1–200 chars' })
    patch.name = name
  }
  if (body?.description !== undefined) patch.description = body.description?.trim() || null
  if (body?.standard_price_cents !== undefined) {
    if (!Number.isInteger(body.standard_price_cents) || body.standard_price_cents < 0) {
      throw createProblemError({ status: 400, title: 'standard_price_cents must be a whole number of cents' })
    }
    patch.standardPriceCents = body.standard_price_cents
  }
  if (body?.standard_billing !== undefined) patch.standardBilling = body.standard_billing
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'nothing to update' })
  await db.update(products).set(patch).where(eq(products.id, id))
  return { id, ...patch }
})
