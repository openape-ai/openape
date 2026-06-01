import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { nests } from '../../database/schema'
import { requireOwnerWithScope } from '../../utils/auth'
import { pickUniqueHostId, slugifyHostId } from '../../utils/nest-slug'

// POST /api/nests/bind  { display_name, pod_uuid? }
//
// Binds a device (pod) to the Owner (M4δ). Gated by the `nest:bind`
// scope — reached either via the Owner's own session/CLI token, or via
// the standing delegation grant the Owner approved on the M4γ consent
// page when authorizing the pod.
//
// troop is the canonical issuer of host_id, and it's owner-scoped: we
// slugify display_name and de-duplicate *within the owner* (mbp-home,
// mbp-home-2, …). Two different Owners can each hold `mbp-home`.
//
// Idempotency: if pod_uuid is supplied and an active nest with that
// pod_uuid already exists for this Owner, we return its existing host_id
// instead of minting a second binding. This makes a pod's bind call
// safe to retry (e.g. after a container recreate that reuses the same
// pod_uuid) without spawning duplicate rows.

export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnerWithScope(event, 'nest:bind')
  const ownerEmail = owner.toLowerCase()

  const body = await readBody<{ display_name?: unknown, pod_uuid?: unknown }>(event)
  const displayName = String(body?.display_name ?? '').trim()
  if (!displayName) {
    throw createError({ statusCode: 400, statusMessage: 'display_name required' })
  }
  const podUuid = body?.pod_uuid == null ? null : String(body.pod_uuid).trim() || null

  const db = useDb()

  // Re-bind idempotency: same Owner + same pod_uuid + still active → reuse.
  if (podUuid) {
    const existing = await db
      .select({ hostId: nests.hostId, displayName: nests.displayName })
      .from(nests)
      .where(and(
        eq(nests.ownerEmail, ownerEmail),
        eq(nests.podUuid, podUuid),
        eq(nests.status, 'active'),
      ))
      .limit(1)
    if (existing[0]) {
      return { host_id: existing[0].hostId, display_name: existing[0].displayName, reused: true }
    }
  }

  // Mint an owner-unique host_id from the display name.
  const taken = new Set(
    (await db
      .select({ hostId: nests.hostId })
      .from(nests)
      .where(eq(nests.ownerEmail, ownerEmail)))
      .map(r => r.hostId),
  )
  const hostId = pickUniqueHostId(slugifyHostId(displayName), taken)

  await db.insert(nests).values({
    ownerEmail,
    hostId,
    displayName,
    podUuid,
    status: 'active',
    createdAt: Date.now(),
  })

  setResponseStatus(event, 201)
  return { host_id: hostId, display_name: displayName, reused: false }
})
