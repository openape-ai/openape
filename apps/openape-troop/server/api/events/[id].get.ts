import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { attentionEvents } from '../../database/schema'
import { findResolution, resolveEventOwner, toWire } from '../../utils/attention-events'

// One attention event plus what a decision card needs around it: the
// resolving event (if any) and the task's attached proofs.
export default defineEventHandler(async (event) => {
  const ownerEmail = await resolveEventOwner(event)
  const id = getRouterParam(event, 'id')

  const db = useDb()
  const row = await db.select().from(attentionEvents).where(and(eq(attentionEvents.id, String(id)), eq(attentionEvents.ownerEmail, ownerEmail))).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  const taskEvents = await db.select().from(attentionEvents).where(and(eq(attentionEvents.taskRef, row.taskRef), eq(attentionEvents.ownerEmail, ownerEmail))).orderBy(asc(attentionEvents.ts), asc(attentionEvents.id)).limit(500)

  const resolution = findResolution(taskEvents, row.id)
  return {
    event: toWire(row),
    resolution: resolution ? toWire(resolution) : null,
    proofs: taskEvents.filter(r => r.type === 'proof.attached').map(toWire),
  }
})
