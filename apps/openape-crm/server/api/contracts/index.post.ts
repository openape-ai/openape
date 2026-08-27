import { eq } from 'drizzle-orm'
import { nextOfferNumber } from '#shared/offer'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { contractLines, contracts, deals, notes } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { requireRole } from '../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{
    deal_id?: string
    start_date?: string
    minimum_term_months?: number | null
    currency?: string
    conditions?: string
    positionen?: { product_id: string, price_cents: number, discount_cents?: number, billing: string }[]
  }>(event)
  const dealId = body?.deal_id
  const positionen = body?.positionen
  if (!dealId) throw createProblemError({ status: 400, title: 'deal_id required' })
  if (!Array.isArray(positionen) || !positionen.length) throw createProblemError({ status: 400, title: 'positionen required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const year = new Date().getFullYear()
  const existing = await db
    .select({ offerNumber: contracts.offerNumber })
    .from(contracts)
    .where(eq(contracts.workspaceId, deal.workspaceId))
    .all()
  const offerNumber = nextOfferNumber(existing.map(r => r.offerNumber), year)
  const id = ulid()
  const now = Date.now()
  await db.insert(contracts).values({
    id,
    workspaceId: deal.workspaceId,
    dealId,
    status: 'offen',
    startDate: body.start_date || new Date().toISOString().slice(0, 10),
    minimumTermMonths: body.minimum_term_months ?? null,
    currency: body.currency || 'EUR',
    offerNumber,
    conditions: body.conditions || null,
    createdAt: now,
  })
  for (const line of positionen) {
    await db.insert(contractLines).values({
      id: ulid(),
      contractId: id,
      productId: line.product_id,
      priceCents: line.price_cents,
      discountCents: line.discount_cents ?? 0,
      billing: line.billing,
    })
  }
  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId,
    authorEmail: caller.email,
    kind: 'mail',
    title: `Angebot ${offerNumber} versendet`,
    body: 'Vertrag im Status „offen“ angelegt.',
    createdAt: now,
  })
  setResponseStatus(event, 201)
  return { id, offer_number: offerNumber, status: 'offen' }
})
