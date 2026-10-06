import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { consumers } from '../database/schema'
import { createProblemError } from './problem'

export type ConsumerRow = typeof consumers.$inferSelect

/** Load a consumer the caller is allowed to see at all, else 404. */
export async function loadConsumer(id: string, caller: string): Promise<ConsumerRow> {
  const row = await useDb().select().from(consumers).where(eq(consumers.id, id)).get()
  // A consumer nobody may touch is indistinguishable from one that does not
  // exist — otherwise this endpoint enumerates other people's machines.
  if (!row || !mayRequestFor(row, caller)) {
    throw createProblemError({ status: 404, title: 'Consumer not found' })
  }
  return row
}

/**
 * Who may raise a request against a consumer: its owner, plus any identity the
 * owner listed explicitly. Empty list means owner-only — an open default would
 * let anyone push fill prompts at a stranger, and a prompt that looks official
 * is how people get talked into pasting secrets.
 */
export function mayRequestFor(consumer: ConsumerRow, caller: string): boolean {
  if (consumer.ownerEmail === caller) return true
  try {
    const allowed = JSON.parse(consumer.allowedRequesters) as string[]
    return Array.isArray(allowed) && allowed.includes(caller)
  }
  catch {
    // A corrupt allowlist grants nothing. Fail closed.
    return false
  }
}

/** Load a consumer owned by this caller, else 404. */
export async function loadOwnConsumer(id: string, owner: string): Promise<ConsumerRow> {
  const row = await useDb().select().from(consumers).where(and(eq(consumers.id, id), eq(consumers.ownerEmail, owner))).get()
  if (!row) throw createProblemError({ status: 404, title: 'Consumer not found' })
  return row
}

/** The caller's email from the DDISA session or bearer token. */
export async function callerEmail(event: H3Event): Promise<string> {
  const caller = await requireCaller(event)
  return caller.email
}
