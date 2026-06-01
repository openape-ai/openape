import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/orgs'

// GET /api/orgs/:id/members/:email/spawn-status
//
// Long-poll endpoint. Each call:
//   1. Read member row, return immediately if no intent in flight
//   2. If the cached troop bearer is still alive: GET troop's
//      /api/agents/spawn-intent/<id> with it
//   3. If troop reports done + agent_email → delete placeholder row +
//      insert real-email row (PK swap), status='active'
//   4. If troop reports failure → set spawn_status='failed' + error
//   5. If the cached bearer expired before the spawn finished →
//      surface 'spawn link expired, retry' so the UI prompts a fresh
//      subject_token from the frontend's standing-grant
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

  const now = Math.floor(Date.now() / 1000)
  if (!member.spawnTroopBearer || !member.spawnTroopBearerExpiresAt || member.spawnTroopBearerExpiresAt <= now) {
    await db.update(orgMembers)
      .set({ spawnStatus: 'failed', spawnError: 'troop bearer expired before spawn completed — retry from chart' })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
    return { status: 'failed', agent_email: null, error: 'spawn link expired — retry from the chart' }
  }

  const config = useRuntimeConfig()
  const troopBase = config.troopApiBase as string

  let troopRes: { pending?: boolean, ok?: boolean, agent_email?: string, error?: string }
  try {
    troopRes = await ($fetch as any)(`${troopBase}/api/agents/spawn-intent/${member.spawnIntentId}`, {
      headers: { Authorization: `Bearer ${member.spawnTroopBearer}` },
    })
  }
  catch (err: any) {
    // Don't tear down spawn_status on transient troop hiccups — return
    // 'pending' with the error info, UI keeps polling and might recover.
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

  // Success — PK swap from placeholder to real agent_email, status='active',
  // clear all spawn-tracking columns.
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
    spawnTroopBearer: null,
    spawnTroopBearerExpiresAt: null,
    spawnGrantId: null,
  })

  return { status: 'active', agent_email: realEmail, error: null }
})
