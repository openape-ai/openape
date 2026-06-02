import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { nests } from '../../database/schema'
import { signCliToken } from '../../utils/cli-token'
import { hashDeviceSecret, NEST_DEVICE_SCOPES, NEST_TOKEN_TTL_SECONDS } from '../../utils/nest-credential'

// POST /api/nests/token  { host_id, device_secret }
//
// Session-less device → troop-token mint (M4δ-3). This is the endpoint a
// keypair-less pod hits on every reconnect. It is intentionally NOT
// behind requireOwner*: the pod has no Owner session and no DDISA agent
// identity. Its only credential is the device secret minted at bind time
// (see bind.post.ts), which troop stores as a SHA-256.
//
// The "standing grant" is the troop-side nests row itself, not an IdP M4γ
// grant — troop is the canonical issuer. Lookup is by the secret hash
// (256-bit, collision-free) cross-checked against host_id; the row yields
// the owner_email. A revoked nest (status != 'active') fails the lookup,
// so an Owner's DELETE /api/nests/:host_id cuts the device off within one
// token TTL.
//
// The minted token carries act='agent', the bounded NEST_DEVICE_SCOPES,
// and delegate='nest:<host_id>' for provenance. requireOwnerWithScope on
// the operational routes enforces the scope cap.

export default defineEventHandler(async (event) => {
  const body = await readBody<{ host_id?: unknown, device_secret?: unknown }>(event)
  const hostId = String(body?.host_id ?? '').trim()
  const deviceSecret = String(body?.device_secret ?? '')
  if (!hostId || !deviceSecret) {
    throw createError({ statusCode: 400, statusMessage: 'host_id and device_secret required' })
  }

  const db = useDb()
  const rows = await db
    .select({ ownerEmail: nests.ownerEmail, hostId: nests.hostId })
    .from(nests)
    .where(and(
      eq(nests.hostId, hostId),
      eq(nests.deviceSecretHash, hashDeviceSecret(deviceSecret)),
      eq(nests.status, 'active'),
    ))
    .limit(1)

  const nest = rows[0]
  if (!nest) {
    throw createError({ statusCode: 401, statusMessage: 'invalid host_id or device_secret, or nest revoked' })
  }

  await db
    .update(nests)
    .set({ lastSeenAt: Date.now() })
    .where(and(eq(nests.ownerEmail, nest.ownerEmail), eq(nests.hostId, nest.hostId)))

  const { token, expiresAt } = await signCliToken({
    email: nest.ownerEmail,
    act: 'agent',
    scope: [...NEST_DEVICE_SCOPES],
    delegate: `nest:${nest.hostId}`,
    ttlSeconds: NEST_TOKEN_TTL_SECONDS,
  })

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: NEST_TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    scope: [...NEST_DEVICE_SCOPES],
  }
})
