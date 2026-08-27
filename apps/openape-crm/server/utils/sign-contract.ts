import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Phase } from '#shared/pipelines'
import { isPhase } from '#shared/pipelines'
import { signaturPlan } from '#shared/signatur'
import { contracts, deals, notes, threadMessages, threads } from '../database/schema'
import { applyStufePatch } from './pipelines'
import { createProblemError } from './problem'

type Db = ReturnType<typeof import('../database/drizzle').useDb>

export async function applySignaturStub(db: Db, contractId: string, actorEmail: string) {
  const contract = await db.select().from(contracts).where(eq(contracts.id, contractId)).get()
  if (!contract) throw createProblemError({ status: 404, title: 'contract not found' })
  const deal = await db.select().from(deals).where(eq(deals.id, contract.dealId)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  const phase: Phase = isPhase(deal.phase) ? deal.phase : 'deal'
  const plan = signaturPlan({ phase, stufe: deal.stufe })
  const now = Date.now()

  await db.update(contracts).set({ status: plan.contractStatus }).where(eq(contracts.id, contractId))

  await db.insert(notes).values({
    id: ulid(),
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    authorEmail: actorEmail,
    kind: 'dokument',
    title: `Angebot ${contract.offerNumber} signiert (Stub)`,
    body: 'Signatur simuliert. Vertrag ist aktiv.',
    createdAt: now,
  })

  const threadId = ulid()
  await db.insert(threads).values({
    id: threadId,
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    subject: `Signiertes Angebot ${contract.offerNumber}`,
    status: plan.threadStatus,
    source: plan.threadSource,
    createdAt: now,
  })
  await db.insert(threadMessages).values({
    id: ulid(),
    threadId,
    fromAddress: 'system@openape.ai',
    body: `Das Angebot ${contract.offerNumber} wurde signiert. Das PDF liegt am Vertrag.`,
    createdAt: now,
  })

  if (plan.stufe) {
    const applied = applyStufePatch({ phase, stufe: deal.stufe }, 'gewonnen', now)
    await db.update(deals).set({
      phase: applied.fields.phase,
      stufe: applied.fields.stufe,
      stage: applied.fields.stufe,
      closedAt: applied.fields.closedAt,
    }).where(eq(deals.id, deal.id))
    if (applied.log) {
      await db.insert(notes).values({
        id: ulid(),
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        authorEmail: actorEmail,
        kind: 'notiz',
        title: applied.log.title,
        body: applied.log.body,
        createdAt: now,
      })
    }
  }

  return { id: contract.id, status: plan.contractStatus, offer_number: contract.offerNumber, deal_id: deal.id }
}
