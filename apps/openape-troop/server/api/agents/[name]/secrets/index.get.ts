import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSecrets } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'

// List the capability secrets bound to an agent. Returns env names +
// status + timestamps only — never the sealed blob or any plaintext.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const rows = await db
    .select({
      env: agentSecrets.env,
      createdAt: agentSecrets.createdAt,
      updatedAt: agentSecrets.updatedAt,
      revokedAt: agentSecrets.revokedAt,
    })
    .from(agentSecrets)
    .where(eq(agentSecrets.agentEmail, agent.email))
    .all()

  return {
    secrets: rows.map(r => ({
      env: r.env,
      status: r.revokedAt ? 'revoked' : 'active',
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      revoked_at: r.revokedAt,
    })),
  }
})
