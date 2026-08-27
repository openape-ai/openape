import { eq } from 'drizzle-orm'
import { defineEventHandler, getQuery } from 'h3'
import { vertragsArt, vertragsende, vertragsWert } from '#shared/contracts'
import { useDb } from '../../database/drizzle'
import { contractLines, contracts, deals, products } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const dealId = String(getQuery(event).deal_id ?? '')
  if (!dealId) throw createProblemError({ status: 400, title: 'deal_id required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const rows = await db.select().from(contracts).where(eq(contracts.dealId, dealId)).all()
  const productRows = await db.select().from(products).where(eq(products.workspaceId, deal.workspaceId)).all()
  const productName = new Map(productRows.map(p => [p.id, p.name]))
  const result = []
  for (const c of rows) {
    const lines = await db.select().from(contractLines).where(eq(contractLines.contractId, c.id)).all()
    const positionen = lines.map(l => ({
      produktId: l.productId,
      name: productName.get(l.productId) ?? l.productId,
      preis: l.priceCents,
      rabatt: l.discountCents,
      abrechnung: l.billing,
    }))
    result.push({
      id: c.id,
      status: c.status,
      start_date: c.startDate,
      minimum_term_months: c.minimumTermMonths,
      currency: c.currency,
      offer_number: c.offerNumber,
      conditions: c.conditions,
      web_url: c.webUrl,
      signed_web_url: c.signedWebUrl,
      art: vertragsArt({ positionen }),
      wert: vertragsWert({ positionen }),
      ende: vertragsende({ startdatum: c.startDate, mindestlaufzeit: c.minimumTermMonths }),
      positionen,
    })
  }
  return result
})
