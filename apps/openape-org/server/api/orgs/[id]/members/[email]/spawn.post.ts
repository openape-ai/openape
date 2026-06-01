import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { z } from 'zod'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/orgs'
import { getRoleDefaults, instantiateRoleDefaults } from '../../../../../utils/role-defaults'

// POST /api/orgs/:id/members/:email/spawn
//
// Triggered by the Owner from the chart UI on a placeholder card.
// The frontend has already:
//   (a) verified the Owner has a standing delegation grant at the
//       User-IdP for (delegate=org.openape.ai, audience=troop.openape.ai,
//       scope=troop:spawn-agent) — see the chart's onSpawnAgent
//   (b) fetched the AuthZ-JWT via /api/grants/{id}/token (browser,
//       credentials:include against the IdP)
// and POSTs it here as `subject_token` along with the `grant_id` for
// audit.
//
// Server-side dance:
//   1. Verify the placeholder member row + Owner ownership of the org
//   2. POST troop.openape.ai/api/cli/exchange with the subject_token →
//      receive a troop CLI bearer with the scope we asked for
//   3. POST troop.openape.ai/api/agents/spawn-intent with that bearer +
//      per-role defaults (recipe ref + system prompt)
//   4. Cache the troop bearer + intent_id + grant_id on the member row
//      so the polling endpoint can reuse the bearer for 15 min
//   5. Return { intent_id } — UI starts polling spawn-status

const Body = z.object({
  subject_token: z.string().min(20),
  grant_id: z.string().min(8).optional(),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const db = useDb()
  const rows = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email))).limit(1)
  const member = rows[0]
  if (!member) throw createError({ statusCode: 404, statusMessage: 'member not found' })
  if (member.status === 'active') throw createError({ statusCode: 409, statusMessage: 'agent already active' })
  if (member.spawnIntentId && member.spawnStatus === 'pending') {
    return { intent_id: member.spawnIntentId, already_pending: true }
  }

  const config = useRuntimeConfig()
  const troopBase = config.troopApiBase as string

  // Exchange the AuthZ-JWT for a troop-scoped CLI bearer (M4α at troop).
  let exchange: { access_token: string, expires_at: number, scope: string[] }
  try {
    exchange = await $fetch<{ access_token: string, expires_at: number, scope: string[] }>(`${troopBase}/api/cli/exchange`, {
      method: 'POST',
      body: { subject_token: parsed.data.subject_token, scopes: ['troop:spawn-agent'] },
    })
  }
  catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `troop /api/cli/exchange rejected: ${err?.data?.statusMessage ?? err?.data?.detail ?? err?.message ?? 'unknown'}`,
    })
  }

  const defaults = instantiateRoleDefaults(getRoleDefaults(member.role), {
    org_id: org.id,
    org_name: org.name,
  })

  const spawnBody: Record<string, unknown> = { name: member.agentName }
  if (defaults.systemPrompt) spawnBody.system_prompt = defaults.systemPrompt
  if (defaults.recipeRef) {
    spawnBody.recipe = { repo_ref: defaults.recipeRef, params: defaults.recipeParams ?? {} }
  }

  let intentId: string
  try {
    const res = await ($fetch as any)(`${troopBase}/api/agents/spawn-intent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${exchange.access_token}` },
      body: spawnBody,
    })
    intentId = res.intent_id
  }
  catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `troop /api/agents/spawn-intent rejected: ${err?.data?.statusMessage ?? err?.message ?? 'unknown'}`,
    })
  }

  await db.update(orgMembers)
    .set({
      spawnIntentId: intentId,
      spawnStatus: 'pending',
      spawnError: null,
      spawnTroopBearer: exchange.access_token,
      spawnTroopBearerExpiresAt: exchange.expires_at,
      spawnGrantId: parsed.data.grant_id ?? null,
    })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))

  return { intent_id: intentId, scope: exchange.scope }
})
