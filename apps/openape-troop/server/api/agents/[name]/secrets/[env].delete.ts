import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSecrets } from '../../../../database/schema'
import { buildSecretRevokeFrame } from '../../../../utils/agent-secrets'
import { requireOwner } from '../../../../utils/auth'
import { broadcastToOwner } from '../../../../utils/nest-registry'

// Revoke a bound secret. Soft tombstone: the sealed blob is cleared
// and `revoked_at` set (binding history stays auditable), and a
// secret-revoke frame is pushed so the agent drops its copy on the
// next connect.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const env = getRouterParam(event, 'env')
  if (!name || !env) throw createError({ statusCode: 400, statusMessage: 'name and env are required' })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const now = Math.floor(Date.now() / 1000)
  const updated = await db
    .update(agentSecrets)
    .set({ sealed: null, revokedAt: now, updatedAt: now })
    .where(and(eq(agentSecrets.agentEmail, agent.email), eq(agentSecrets.env, env)))
    .returning({ env: agentSecrets.env })

  if (updated.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'secret not found' })
  }

  broadcastToOwner(owner.toLowerCase(), buildSecretRevokeFrame(agent.email, env) as unknown as Record<string, unknown>)
  return { ok: true, env }
})
