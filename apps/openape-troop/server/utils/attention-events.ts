import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
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
