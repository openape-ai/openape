import type { H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import type { attentionEvents } from '../database/schema'
import { agents } from '../database/schema'
import { requireAgent, requireOwner } from './auth'

/**
 * Resolve who an attention event is written FOR (the owner whose inbox
 * it belongs to). Two writer identities:
 *   - the owner themselves (session / human CLI bearer) → their own inbox
 *   - a registered agent (act='agent' bearer) → its owner's inbox
 */
export async function resolveEventOwner(event: H3Event): Promise<string> {
  try {
    return await requireOwner(event)
  }
  catch {
    const agentEmail = await requireAgent(event)
    const row = await useDb().select({ ownerEmail: agents.ownerEmail }).from(agents).where(eq(agents.email, agentEmail)).get()
    if (!row) {
      throw createError({ statusCode: 403, statusMessage: 'agent not registered with troop' })
    }
    return row.ownerEmail
  }
}

const RELATIVE_SINCE = /^-(\d+)([smhd])$/
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const

/**
 * Parse the `since` query param into unix seconds. Accepts absolute unix
 * seconds ("1785758183") or a relative offset ("-1h", "-30m", "-2d").
 * Returns null for absent input; throws 400 on garbage.
 */
export function parseSince(input: string | undefined, nowSeconds: number): number | null {
  if (!input) return null
  const relative = RELATIVE_SINCE.exec(input)
  if (relative) {
    const [, amount, unit] = relative
    return nowSeconds - Number(amount) * UNIT_SECONDS[unit as keyof typeof UNIT_SECONDS]
  }
  if (/^\d+$/.test(input)) return Number(input)
  throw createError({ statusCode: 400, statusMessage: 'since must be unix seconds or a relative offset like -1h' })
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Generate a ULID (10 time chars from unix ms + 16 chars from 80 random bits). */
export function newUlid(nowMs = Date.now()): string {
  let time = ''
  for (let i = 0, t = nowMs; i < 10; i++, t = Math.floor(t / 32)) {
    time = CROCKFORD[t % 32] + time
  }
  let rand = ''
  for (let bits = BigInt(`0x${randomBytes(10).toString('hex')}`), i = 0; i < 16; i++, bits >>= 5n) {
    rand = CROCKFORD[Number(bits & 31n)] + rand
  }
  return time + rand
}

type AttentionEventRow = typeof attentionEvents.$inferSelect

/** Map a DB row to the wire shape shared by all /api/events responses. */
export function toWire(row: AttentionEventRow) {
  return {
    id: row.id,
    ts: row.ts,
    actor: row.actor,
    actor_kind: row.actorKind,
    task_ref: row.taskRef,
    ...(row.goalRef ? { goal_ref: row.goalRef } : {}),
    ...(row.orgId ? { org_id: row.orgId } : {}),
    type: row.type,
    payload: row.payload,
  }
}

const REQUEST_TYPES = ['decision.requested', 'work.blocked', 'verdict.requested'] as const
const RESOLUTION_TYPES = ['decision.made', 'verdict.given'] as const

export function isRequestType(type: string): boolean {
  return (REQUEST_TYPES as readonly string[]).includes(type)
}

/** Find the event that resolves `requestId` among its task's events, if any. */
export function findResolution(rows: AttentionEventRow[], requestId: string): AttentionEventRow | null {
  return rows.find(row =>
    (RESOLUTION_TYPES as readonly string[]).includes(row.type)
    && (row.payload as { request_id?: string }).request_id === requestId,
  ) ?? null
}
