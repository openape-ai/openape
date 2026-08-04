import { AttentionEventSchema } from '@openape/attention-events'
import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { attentionEvents } from '../../../database/schema'
import { requireOwner } from '../../../utils/auth'
import { findResolution, isRequestType, newUlid } from '../../../utils/attention-events'

// Resolve an open request card with one click. Humans only — agents never
// answer their own requests. Body: { choice } for decision.requested /
// work.blocked, { verdict } for verdict.requested. Writes the resolving
// event (decision.made / verdict.given) into the same task's log.
export default defineEventHandler(async (event) => {
  const ownerEmail = await requireOwner(event)
  const id = getRouterParam(event, 'id')

  const db = useDb()
  const row = await db.select().from(attentionEvents).where(and(eq(attentionEvents.id, String(id)), eq(attentionEvents.ownerEmail, ownerEmail))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'event not found' })
  if (!isRequestType(row.type)) {
    throw createError({ statusCode: 400, statusMessage: `${row.type} is not resolvable` })
  }

  const taskEvents = await db.select().from(attentionEvents).where(and(eq(attentionEvents.taskRef, row.taskRef), eq(attentionEvents.ownerEmail, ownerEmail))).orderBy(asc(attentionEvents.ts), asc(attentionEvents.id)).limit(500)
  const existing = findResolution(taskEvents, row.id)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `already resolved by ${existing.id}` })
  }

  const body = await readBody<{ choice?: string, verdict?: string }>(event)
  const isCall = row.type === 'call.raised'
  const isVerdict = row.type === 'verdict.requested' || (isCall && (row.payload as { kind?: string }).kind === 'verdict')
  const resolving = AttentionEventSchema.parse({
    id: newUlid(),
    ts: Math.floor(Date.now() / 1000),
    actor: ownerEmail,
    actor_kind: 'human',
    task_ref: row.taskRef,
    ...(row.goalRef ? { goal_ref: row.goalRef } : {}),
    ...(row.orgId ? { org_id: row.orgId } : {}),
    // Answer in the dialect the request was raised in, so a log stays readable.
    type: isCall ? 'call.answered' : isVerdict ? 'verdict.given' : 'decision.made',
    payload: isCall
      ? { answer: body?.verdict ?? body?.choice, request_id: row.id }
      : isVerdict
        ? { verdict: body?.verdict, request_id: row.id }
        : { decision: body?.choice, request_id: row.id },
  })

  await db.insert(attentionEvents).values({
    id: resolving.id,
    ownerEmail,
    ts: resolving.ts,
    actor: resolving.actor,
    actorKind: resolving.actor_kind,
    taskRef: resolving.task_ref,
    goalRef: resolving.goal_ref ?? null,
    orgId: resolving.org_id ?? null,
    type: resolving.type,
    payload: resolving.payload,
    receivedAt: Math.floor(Date.now() / 1000),
  })

  setResponseStatus(event, 201)
  // The parsed event already IS the wire shape.
  return resolving
})
