import { and, eq, gte } from 'drizzle-orm'
import { attentionEvents } from '../database/schema'
import { isRequestType } from './attention-events'

// A card is worth a buzz; a proof or a status change is not. And a loop that
// raises five cards in a minute must not buzz five times — after the first,
// we summarise instead.
const BURST_WINDOW_SECONDS = 600

const TITLES: Record<string, string> = {
  'decision.requested': 'Entscheidung',
  'work.blocked': 'Eskalation',
  'verdict.requested': 'Verdict',
  'call.raised': 'Entscheidung',
}

const CALL_KIND_TITLES: Record<string, string> = {
  decision: 'Entscheidung',
  escalation: 'Eskalation',
  verdict: 'Verdict',
}

/** How many request cards of this owner are still unanswered. */
export async function openCardCount(ownerEmail: string, sinceSeconds: number): Promise<number> {
  // Imported here, not at module scope: the db and push modules pull in the
  // Nitro runtime, which would make this file unloadable outside a server.
  const { useDb } = await import('../database/drizzle')
  const rows = await useDb().select().from(attentionEvents).where(and(eq(attentionEvents.ownerEmail, ownerEmail), gte(attentionEvents.ts, sinceSeconds)))
  const resolved = new Set(rows
    .filter(r => r.type === 'decision.made' || r.type === 'verdict.given')
    .map(r => (r.payload as { request_id?: string }).request_id))
  return rows.filter(r => isRequestType(r.type) && !resolved.has(r.id)).length
}

/** Notification body for a card — the question itself, or the PR under review. */
export function cardMessage(type: string, payload: Record<string, unknown>, openCount: number) {
  const title = (type === 'call.raised' ? CALL_KIND_TITLES[String(payload.kind)] : TITLES[type]) ?? 'Karte'
  if (openCount > 1) {
    return { title: `${openCount} Calls warten`, body: `Zuletzt: ${describe(type, payload)}`, url: '/inbox' }
  }
  return { title, body: describe(type, payload) }
}

function describe(type: string, payload: Record<string, unknown>): string {
  const title = payload.title as string | undefined
  if (title) return title
  const question = payload.question as string | undefined
  if (question) return question
  const prUrl = payload.pr_url as string | undefined
  return prUrl ? `Review wartet: ${prUrl}` : (TITLES[type] ?? 'Karte')
}

/**
 * Buzz the owner about a freshly raised card. Fire-and-forget: notification
 * trouble must never fail the ingest that triggered it.
 */
export async function notifyCardRaised(ownerEmail: string, event: { id: string, type: string, ts: number, payload: Record<string, unknown> }) {
  if (!isRequestType(event.type)) return
  const openCount = await openCardCount(ownerEmail, event.ts - BURST_WINDOW_SECONDS)
  const message = cardMessage(event.type, event.payload, openCount)
  const { pushToOwner } = await import('./cockpit/push')
  await pushToOwner(ownerEmail, { url: `/c/${event.id}`, ...message })
}
