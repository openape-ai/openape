import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { attentionEvents } from '../../database/schema'
import { autoResolutionValues, findResolution, resolveEventOwner, timeoutOutcome, toWire } from '../../utils/attention-events'

// Waiting for a human is a query over durable state, not a subscription: a
// waiter may die and come back, the answer stays in the log. `?wait=<seconds>`
// (max 30) long-polls so an agent that IS still alive hears back immediately
// instead of on its next tick.
const MAX_WAIT_SECONDS = 30
const POLL_INTERVAL_MS = 1000

export default defineEventHandler(async (event) => {
  const ownerEmail = await resolveEventOwner(event)
  const id = String(getRouterParam(event, 'id'))
  const waitParam = Number(getQuery(event).wait ?? 0)
  const deadlineMs = Date.now() + Math.min(Number.isFinite(waitParam) ? Math.max(waitParam, 0) : 0, MAX_WAIT_SECONDS) * 1000

  const db = useDb()
  const row = await db.select().from(attentionEvents).where(and(eq(attentionEvents.id, id), eq(attentionEvents.ownerEmail, ownerEmail))).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  async function taskLog() {
    return db.select().from(attentionEvents).where(and(eq(attentionEvents.taskRef, row!.taskRef), eq(attentionEvents.ownerEmail, ownerEmail))).orderBy(asc(attentionEvents.ts), asc(attentionEvents.id)).limit(500)
  }

  let taskEvents = await taskLog()
  let resolution = findResolution(taskEvents, row.id)

  while (!resolution && Date.now() < deadlineMs) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    taskEvents = await taskLog()
    resolution = findResolution(taskEvents, row.id)
  }

  let expired = false
  if (!resolution) {
    const now = Math.floor(Date.now() / 1000)
    const outcome = timeoutOutcome(row, now)
    if (outcome === 'apply') {
      const values = autoResolutionValues(row, ownerEmail, now)
      await db.insert(attentionEvents).values(values)
      resolution = { ...values, payload: values.payload as Record<string, unknown> }
    }
    expired = outcome === 'expire'
  }

  return {
    event: toWire(row),
    resolution: resolution ? toWire(resolution) : null,
    expired,
    proofs: taskEvents.filter(r => r.type === 'proof.attached').map(toWire),
  }
})
