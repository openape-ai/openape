import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { orgMembers } from '../database/schema'
import { getRoleDefaults, instantiateRoleDefaults } from './role-defaults'
import { getPersona } from './persona-catalog'

export interface SpawnOrgRef { id: string, name: string }

/**
 * Core of the Owner-triggered spawn: exchange the delegation AuthZ-JWT for
 * a troop-scoped bearer, POST the per-role spawn-intent to troop, and cache
 * the intent + bearer on the member row so the UI can poll. Extracted from
 * the old POST /spawn handler so the cross-SP redirect/code callback can
 * call it with a server-obtained subject_token (no browser-supplied token).
 */
export async function spawnMemberViaTroop(
  org: SpawnOrgRef,
  memberEmail: string,
  subjectToken: string,
  grantId?: string,
): Promise<{ intentId: string, alreadyPending?: boolean }> {
  const db = useDb()
  const rows = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, memberEmail))).limit(1)
  const member = rows[0]
  if (!member) throw createError({ statusCode: 404, statusMessage: 'member not found' })
  if (member.status === 'active') throw createError({ statusCode: 409, statusMessage: 'agent already active' })
  if (member.spawnIntentId && member.spawnStatus === 'pending') {
    return { intentId: member.spawnIntentId, alreadyPending: true }
  }

  const config = useRuntimeConfig()
  const troopBase = config.troopApiBase as string

  let exchange: { access_token: string, expires_at: number, scope: string[] }
  try {
    exchange = await $fetch<{ access_token: string, expires_at: number, scope: string[] }>(`${troopBase}/api/cli/exchange`, {
      method: 'POST',
      body: { subject_token: subjectToken, scopes: ['troop:spawn-agent'] },
    })
  }
  catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `troop /api/cli/exchange rejected: ${err?.data?.statusMessage ?? err?.data?.detail ?? err?.message ?? 'unknown'}` })
  }

  // A member created from a catalog persona spawns that persona's recipe;
  // otherwise fall back to the legacy per-role defaults. Either way the
  // {{org_id}} / {{org_name}} placeholders in the params are substituted here.
  const persona = getPersona(member.persona)
  const defaults = persona
    ? instantiateRoleDefaults(
        { recipeRef: persona.recipeRef, recipeParams: persona.recipeParams },
        { org_id: org.id, org_name: org.name },
      )
    : instantiateRoleDefaults(getRoleDefaults(member.role), { org_id: org.id, org_name: org.name })
  const spawnBody: Record<string, unknown> = { name: member.agentName }
  if (defaults.systemPrompt) spawnBody.system_prompt = defaults.systemPrompt
  if (defaults.recipeRef) spawnBody.recipe = { repo_ref: defaults.recipeRef, params: defaults.recipeParams ?? {} }

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
    throw createError({ statusCode: 502, statusMessage: `troop /api/agents/spawn-intent rejected: ${err?.data?.statusMessage ?? err?.message ?? 'unknown'}` })
  }

  await db.update(orgMembers)
    .set({
      spawnIntentId: intentId,
      spawnStatus: 'pending',
      spawnError: null,
      spawnTroopBearer: exchange.access_token,
      spawnTroopBearerExpiresAt: exchange.expires_at,
      spawnGrantId: grantId ?? null,
    })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, memberEmail)))

  return { intentId }
}
