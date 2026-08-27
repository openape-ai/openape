import { asc, eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { useDb } from '../../database/drizzle'
import { products } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  return await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      standard_price_cents: products.standardPriceCents,
      standard_billing: products.standardBilling,
    })
    .from(products)
    .where(eq(products.workspaceId, workspaceId))
    .orderBy(asc(products.name))
    .all()
})
