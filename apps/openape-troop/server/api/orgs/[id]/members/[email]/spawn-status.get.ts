import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/orgs'
import { getSpawnIntent } from '../../../../../utils/spawn-intents'

// GET /api/orgs/:id/members/:email/spawn-status
//
// B0 merge: in-process status read (no troop bearer, no HTTP, no expiry —
// org IS troop). The UI polls this every 2s while a card is 'pending'.
//   - pending   → intent not resolved yet
//   - active    → nest reported spawn-result.ok: PK-swap the placeholder
//                 row to the real agent email, clear the spawn columns
//   - failed    → nest reported an error
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
      status: member.spawnStatus ?? (member.status === 'active' ? 'active' : 'idle'),
      agent_email: member.status === 'active' ? member.agentEmail : null,
      error: member.spawnError ?? null,
    }
  }

  const intent = getSpawnIntent(member.spawnIntentId)
  if (!intent?.result) {
    return { status: 'pending', agent_email: null, error: null }
  }

  const now = Math.floor(Date.now() / 1000)
  if (!intent.result.ok || !intent.result.agentEmail) {
    await db.update(orgMembers)
      .set({ spawnStatus: 'failed', spawnError: intent.result.error ?? 'spawn failed' })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
    return { status: 'failed', agent_email: null, error: intent.result.error ?? 'spawn failed' }
  }

  // Success: swap the placeholder PK to the real agent email. SQLite has no
  // UPDATE-PK, so delete + re-insert under the new key.
  const realEmail = intent.result.agentEmail
  await db.delete(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))
  await db.insert(orgMembers).values({
    orgId: member.orgId,
    agentEmail: realEmail,
    agentName: member.agentName,
    role: member.role,
    persona: member.persona,
    reportsToEmail: member.reportsToEmail,
    status: 'active',
    spawnedAt: member.spawnedAt ?? now,
    retiredAt: member.retiredAt,
    createdAt: member.createdAt,
  })
  return { status: 'active', agent_email: realEmail, error: null }
})
