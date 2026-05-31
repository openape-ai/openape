import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { getActiveDelegationGrantId } from '../../../../../utils/delegation-grants'
import { requireOwnedOrg } from '../../../../../utils/orgs'
import { exchangeForOwnerBearer } from '../../../../../utils/token-exchange'

// GET /api/orgs/:id/members/:email/spawn-status
//
// Long-poll endpoint. Each call:
//   1. Reads the member row, returns immediately if no intent in flight
//   2. Mints a fresh Owner-Bearer via token-exchange
//   3. GETs troop.openape.ai/api/agents/spawn-intent/<intent_id>
//   4. If troop reports done+agent_email → PATCH org_members PK swap to
//      the real email, status='active', clear spawn columns
//   5. If troop reports failure → set spawn_status='failed' + error
//   6. Returns the latest known state to the UI
//
// The UI polls this every 2s while a card is in 'pending' state.
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const db = useDb()
  const rows = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email))).limit(1)
  const member = rows[0]
  if (!member) throw createError({ statusCode: 404, statusMessage: 'member not found' })

  if (!member.spawnIntentId || member.spawnStatus !== 'pending') {
    return {
      status: member.spawnStatus ?? 'idle',
      agent_email: member.status === 'active' ? member.agentEmail : null,
      error: member.spawnError ?? null,
    }
  }

  const config = useRuntimeConfig()
  const audience = (config.public as { troopAudience?: string }).troopAudience ?? 'apes-cli'
  const grantId = await getActiveDelegationGrantId(org.ownerEmail, audience)
  if (!grantId) {
    // Grant got revoked mid-flight; surface as 'failed' to UI.
    await db.update(orgMembers)
      .set({ spawnStatus: 'failed', spawnError: 'delegation grant revoked' })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
    return { status: 'failed', agent_email: null, error: 'delegation grant revoked' }
  }

  let bearer: string
  try {
    bearer = (await exchangeForOwnerBearer({ delegationGrantId: grantId, audience })).access_token
  }
  catch (err: any) {
    return { status: 'pending', agent_email: null, error: `token-exchange failed: ${err?.message ?? 'unknown'}` }
  }

  let troopRes: { pending?: boolean, ok?: boolean, agent_email?: string, error?: string }
  try {
    const troopBase = config.troopApiBase as string
    // Cast through `any` because Nuxt's typed `$fetch` overload tries
    // to resolve the route key from a string-template and hits
    // "Excessive stack depth" on cross-SP URLs. The shape is
    // guaranteed by the typed local variable above.
    troopRes = await ($fetch as any)(`${troopBase}/api/agents/spawn-intent/${member.spawnIntentId}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
  }
  catch (err: any) {
    return { status: 'pending', agent_email: null, error: `troop poll failed: ${err?.message ?? 'unknown'}` }
  }

  if (troopRes.pending) {
    return { status: 'pending', agent_email: null, error: null }
  }

  if (!troopRes.ok) {
    await db.update(orgMembers)
      .set({ spawnStatus: 'failed', spawnError: troopRes.error ?? 'spawn failed' })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
    return { status: 'failed', agent_email: null, error: troopRes.error ?? 'spawn failed' }
  }

  const realEmail = troopRes.agent_email
  if (!realEmail) {
    return { status: 'pending', agent_email: null, error: 'troop returned ok but no agent_email' }
  }

  // Success — PK swap from placeholder to real agent_email + mark active.
  const now = Math.floor(Date.now() / 1000)
  await db.delete(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
  await db.insert(orgMembers).values({
    orgId: member.orgId,
    agentEmail: realEmail,
    agentName: member.agentName,
    role: member.role,
    reportsToEmail: member.reportsToEmail,
    status: 'active',
    spawnedAt: now,
    retiredAt: member.retiredAt,
    createdAt: member.createdAt,
    spawnIntentId: null,
    spawnStatus: null,
    spawnError: null,
  })

  return { status: 'active', agent_email: realEmail, error: null }
})
