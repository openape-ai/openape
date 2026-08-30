import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { contractLines, contracts, dealFiles, deals, notes } from '../../../database/schema'
import { nextOfferNumber } from '#shared/offer'
import { buildSendMailBody, createOrgLink, encodedDrivePath, ensureDealFolder, graphJson, graphPut } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { simplePdf } from '../../../utils/pdf'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const dealId = getRouterParam(event, 'id')!
  const body = await readBody<{
    to?: string
    start_date?: string
    minimum_term_months?: number | null
    currency?: string
    conditions?: string
    positionen?: { product_id: string, name?: string, price_cents: number, discount_cents?: number, billing: string }[]
  }>(event)
  const positionen = body?.positionen
  const to = body?.to?.trim()
  if (!Array.isArray(positionen) || !positionen.length) throw createProblemError({ status: 400, title: 'positionen required' })
  if (!to) throw createProblemError({ status: 400, title: 'to required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  const year = new Date().getFullYear()
  const existing = await db
    .select({ offerNumber: contracts.offerNumber })
    .from(contracts)
    .where(eq(contracts.workspaceId, deal.workspaceId))
    .all()
  const offerNumber = nextOfferNumber(existing.map(r => r.offerNumber), year)
  const lines = positionen.map(p => `${p.name || p.product_id}: ${(p.price_cents - (p.discount_cents ?? 0)) / 100} ${body.currency || 'EUR'} (${p.billing})`)
  const pdf = simplePdf([
    `Angebot ${offerNumber}`,
    deal.title,
    `Start ${body.start_date || new Date().toISOString().slice(0, 10)}`,
    ...lines,
    body.conditions || '',
  ])
  await ensureDealFolder(graph.accessToken, deal.workspaceId, deal.id)
  const uploaded = await graphPut(
    graph.accessToken,
    `/me/drive/root:/${encodedDrivePath(['OpenApe CRM', deal.workspaceId, deal.id, `${offerNumber}.pdf`])}:/content`,
    pdf,
    'application/pdf',
  )
  const share = await createOrgLink(graph.accessToken, uploaded.id) || uploaded.webUrl
  await graphJson(graph.accessToken, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify(buildSendMailBody({
      to: [to],
      subject: `Angebot ${offerNumber}`,
      body: `Im Anhang: Angebot ${offerNumber}. Lizenzvertrag liegt in OneDrive.`,
      attachments: [{
        name: `${offerNumber}.pdf`,
        contentType: 'application/pdf',
        contentBytes: pdf.toString('base64'),
      }],
    })),
  })
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
    driveItemId: uploaded.id,
    webUrl: share,
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
  await db.insert(dealFiles).values({
    id: ulid(),
    dealId,
    contractId: id,
    name: `${offerNumber}.pdf`,
    driveItemId: uploaded.id,
    webUrl: share,
    mime: 'application/pdf',
    size: pdf.length,
    createdAt: now,
  })
  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId,
    authorEmail: caller.email,
    kind: 'mail',
    title: `Angebot ${offerNumber} versendet`,
    body: `An ${to}. PDF in OneDrive.`,
    createdAt: now,
  })
  setResponseStatus(event, 201)
  return { id, offer_number: offerNumber, status: 'offen', web_url: share }
})
