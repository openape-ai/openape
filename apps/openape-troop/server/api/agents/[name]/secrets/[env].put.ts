import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { agents, agentSecrets } from '../../../../database/schema'
import { buildSecretUpdateFrame, sealSecret, serializeSealed, validateEnvName } from '../../../../utils/agent-secrets'
import { requireOwner } from '../../../../utils/auth'
import { broadcastToOwner } from '../../../../utils/nest-registry'

// Bind or rotate a capability secret for an agent. The plaintext value
// is sealed to the agent's X25519 pubkey immediately and only the
// sealed blob is stored — troop never persists or logs the plaintext.
// The sealed blob is pushed to the owner's nest over the WS so the
// agent gets it without a re-deploy.
const bodySchema = z.object({
  value: z.string().min(1).max(8192),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const env = getRouterParam(event, 'env')
  if (!name || !env) throw createError({ statusCode: 400, statusMessage: 'name and env are required' })

  const envCheck = validateEnvName(env)
  if (!envCheck.ok) throw createError({ statusCode: 400, statusMessage: envCheck.reason })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  const db = useDb()
  const agent = await db
    .select({ email: agents.email, pubkeyX25519: agents.pubkeyX25519 })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  let box
  try {
    box = sealSecret(agent.pubkeyX25519, parsed.data.value)
  }
  catch (e) {
    throw createError({ statusCode: 409, statusMessage: (e as Error).message })
  }
  const sealed = serializeSealed(box)
  const now = Math.floor(Date.now() / 1000)

  const existing = await db
    .select({ env: agentSecrets.env })
    .from(agentSecrets)
    .where(and(eq(agentSecrets.agentEmail, agent.email), eq(agentSecrets.env, env)))
    .get()

  if (existing) {
    await db
      .update(agentSecrets)
      .set({ sealed, updatedAt: now, revokedAt: null })
      .where(and(eq(agentSecrets.agentEmail, agent.email), eq(agentSecrets.env, env)))
  }
  else {
    await db.insert(agentSecrets).values({
      agentEmail: agent.email,
      env,
      sealed,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
  }

  // Frame is a typed interface; broadcastToOwner takes the generic
  // Record<string, unknown> wire shape — assert across the gap.
  broadcastToOwner(owner.toLowerCase(), buildSecretUpdateFrame(agent.email, env, box) as unknown as Record<string, unknown>)

  // Never cache a response on a secret-bearing request path.
  setHeader(event, 'Cache-Control', 'no-store')
  return { ok: true, env }
})
