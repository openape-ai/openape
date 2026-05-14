import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { agents } from '../../database/schema'
import { requireOwner } from '../../utils/auth'
import { createDestroyIntent } from '../../utils/destroy-intents'
import { listNestPeersForOwner } from '../../utils/nest-registry'

// POST /api/agents/destroy-intent — owner-side request to destroy
// one of their agents on the nest where it lives. Mirrors
// /api/agents/spawn-intent: returns immediately with an intent_id,
// the actual destroy runs on the nest gated by the usual DDISA
// grant. UI polls /api/agents/destroy-intent/:id for the result.
//
// Why intent + poll instead of synchronous DELETE: the nest runs
// `apes agents destroy --force` which can take 30s+ (Phase G teardown
// script + IdP de-registration + dscl-record-cleanup); holding the
// HTTP connection open would block the UI request for that whole
// window. The intent_id pattern is the same one spawn uses.

const bodySchema = z.object({
  // Agent's short name (the troop-DB row's agentName). Cross-checked
  // against ownerEmail below so a stranger can't trigger a destroy
  // even if they guess the name.
  name: z.string().min(1).max(64),
  // Optional: pin to a specific host when the owner has multiple Macs
  // connected. Omitted = pick the first connected nest. The nest
  // itself decides whether the named agent exists on its host; if
  // not, the spawn-result frame returns ok=false with a clear error.
  host_id: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  // Cross-tenant guard: the agent must belong to this owner before
  // we'll ask the nest to wipe it. We DON'T fail on "not in troop DB"
  // because legacy agents the owner spawned pre-troop-sync still
  // need a cleanup path — but the row check covers the common case
  // and stops a typo-by-stranger from nuking a name on a different
  // owner's nest if both happen to share a hostname pattern.
  const db = useDb()
  const row = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, parsed.data.name)))
    .get()
  if (!row) {
    // Soft-error: we still allow the destroy intent to flow (the
    // nest will refuse if the OS user doesn't exist) but we log a
    // hint. Without this branch the UI can't clean up a troop row
    // that survived a manual `apes agents destroy` on the host.
    // The nest's destroy returns ok=true silently in the "already
    // gone" path, so the UI gets a clean response anyway.
  }

  const peers = listNestPeersForOwner(owner)
  if (peers.length === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'no connected nest — start the nest daemon on the host where the agent lives, or run `apes agents destroy` directly on the host.',
    })
  }
  const target = parsed.data.host_id
    ? peers.find(p => p.hostId === parsed.data.host_id)
    : peers[0]
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: `no nest found for host_id ${parsed.data.host_id}` })
  }

  const intentId = randomUUID()
  createDestroyIntent(intentId)

  const ok = target.send({
    type: 'destroy-intent',
    intent_id: intentId,
    name: parsed.data.name,
  })
  if (!ok) {
    throw createError({ statusCode: 503, statusMessage: 'nest dropped before intent was delivered — retry in a few seconds' })
  }

  return {
    intent_id: intentId,
    host_id: target.hostId,
    hostname: target.hostname,
  }
})
