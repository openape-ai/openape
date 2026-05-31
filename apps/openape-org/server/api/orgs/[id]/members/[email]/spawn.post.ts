import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { getActiveDelegationGrantId } from '../../../../../utils/delegation-grants'
import { requireOwnedOrg } from '../../../../../utils/orgs'
import { getRoleDefaults, instantiateRoleDefaults } from '../../../../../utils/role-defaults'
import { exchangeForOwnerBearer } from '../../../../../utils/token-exchange'

// POST /api/orgs/:id/members/:email/spawn
//
// Triggered by the Owner from the chart UI on a placeholder card.
// Server-side dance:
//   1. Verify caller is the org owner + member row exists + status is 'invited'
//   2. Look up the Owner's delegation grant for audience=apes-cli
//      → 412 if missing (UI shows the bootstrap-grant flow)
//   3. token-exchange → Bearer with sub=ownerEmail, act=org
//   4. POST troop.openape.ai/api/agents/spawn-intent with that Bearer +
//      per-role defaults (recipe + system prompt)
//   5. Stash intent_id + status='pending' on the member row
//   6. Return { intent_id } — UI starts polling spawn-status
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const db = useDb()
  const rows = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email))).limit(1)
  const member = rows[0]
  if (!member) throw createError({ statusCode: 404, statusMessage: 'member not found' })
  if (member.status === 'active') throw createError({ statusCode: 409, statusMessage: 'agent already active' })
  if (member.spawnIntentId && member.spawnStatus === 'pending') {
    return { intent_id: member.spawnIntentId, already_pending: true }
  }

  const config = useRuntimeConfig()
  const audience = (config.public as { troopAudience?: string }).troopAudience ?? 'apes-cli'
  const grantId = await getActiveDelegationGrantId(org.ownerEmail, audience)
  if (!grantId) {
    throw createError({
      statusCode: 412,
      statusMessage: `no delegation grant for this owner — visit /orgs/${org.id}/settings to bootstrap one`,
    })
  }

  let bearer: string
  try {
    const exchanged = await exchangeForOwnerBearer({ delegationGrantId: grantId, audience })
    bearer = exchanged.access_token
  }
  catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `token-exchange against IdP failed: ${err?.message ?? 'unknown'}`,
    })
  }

  // Apply per-role defaults + substitute {{org_id}} / {{org_name}}.
  const defaults = instantiateRoleDefaults(getRoleDefaults(member.role), {
    org_id: org.id,
    org_name: org.name,
  })

  const spawnBody: Record<string, unknown> = { name: member.agentName }
  if (defaults.systemPrompt) spawnBody.system_prompt = defaults.systemPrompt
  if (defaults.recipeRef) {
    spawnBody.recipe = {
      repo_ref: defaults.recipeRef,
      params: defaults.recipeParams ?? {},
    }
  }

  const troopBase = config.troopApiBase as string
  let intentId: string
  try {
    const res = await $fetch<{ intent_id: string }>(`${troopBase}/api/agents/spawn-intent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}` },
      body: spawnBody,
    })
    intentId = res.intent_id
  }
  catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `troop spawn-intent rejected: ${err?.data?.statusMessage ?? err?.message ?? 'unknown'}`,
    })
  }

  await db.update(orgMembers)
    .set({ spawnIntentId: intentId, spawnStatus: 'pending', spawnError: null })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))

  return { intent_id: intentId }
})
