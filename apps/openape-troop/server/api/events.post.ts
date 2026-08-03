import { AttentionEventSchema } from '@openape/attention-events'
import { useDb } from '../database/drizzle'
import { attentionEvents } from '../database/schema'
import { resolveEventOwner } from '../utils/attention-events'
import { notifyCardRaised } from '../utils/attention-notify'

// Drizzle wraps the LibsqlError, so the UNIQUE hint only appears in the
// cause chain — walk it (bounded) instead of String(err) on the wrapper.
function isUniqueViolation(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (String((e as { message?: string }).message ?? e).includes('UNIQUE constraint failed')) return true
    if ((e as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) return true
  }
  return false
}

// Ingest one attention event (append-only). Writers: the owner (session or
// human CLI bearer) or a registered agent (act='agent' bearer); the event
// lands in the resolved owner's log. 422 on schema violation, 409 on
// duplicate id (ULIDs are writer-generated, so a replayed POST is a dupe,
// not new information).
export default defineEventHandler(async (event) => {
  const ownerEmail = await resolveEventOwner(event)

  const parsed = AttentionEventSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'event does not match @openape/attention-events v1',
      data: { issues: parsed.error.issues },
    })
  }

  const e = parsed.data
  try {
    await useDb().insert(attentionEvents).values({
      id: e.id,
      ownerEmail,
      ts: e.ts,
      actor: e.actor,
      actorKind: e.actor_kind,
      taskRef: e.task_ref,
      goalRef: e.goal_ref ?? null,
      orgId: e.org_id ?? null,
      type: e.type,
      payload: e.payload,
      receivedAt: Math.floor(Date.now() / 1000),
    })
  }
  catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: `event ${e.id} already recorded` })
    }
    throw err
  }

  void notifyCardRaised(ownerEmail, { id: e.id, type: e.type, ts: e.ts, payload: e.payload })
    .catch(err => console.error('[troop/attention] notify failed:', String(err)))

  setResponseStatus(event, 201)
  return { id: e.id }
})
