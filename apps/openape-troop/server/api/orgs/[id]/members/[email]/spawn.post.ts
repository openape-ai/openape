import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { orgMembers } from '../../../../../database/schema'
import { requireOwnedOrg } from '../../../../../utils/orgs'
import { getPersona } from '../../../../../utils/persona-catalog'
import { dispatchSpawnIntent } from '../../../../../utils/spawn-dispatch'

// POST /api/orgs/:id/members/:email/spawn
//
// B0 merge: collapses the former two-hop spawn. Org used to mint PKCE,
// redirect cross-SP to the IdP, exchange for a troop bearer and POST to
// troop over HTTP. Now org IS troop — the owner session already authorizes
// the spawn, so we dispatch the intent IN-PROCESS (same registry the nest-ws
// resolves) and mark the member 'pending'. The status endpoint reads the
// in-process result and swaps the placeholder PK to the real agent email.
export default defineEventHandler(async (event) => {
  const { owner, org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const db = useDb()
  const rows = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email))).limit(1)
  const member = rows[0]
  if (!member) throw createError({ statusCode: 404, statusMessage: 'member not found' })
  if (member.status === 'active') throw createError({ statusCode: 409, statusMessage: 'member already active' })
  if (!member.persona) throw createError({ statusCode: 400, statusMessage: 'member has no persona to spawn from' })

  const persona = getPersona(member.persona)
  if (!persona?.recipeRef) {
    throw createError({ statusCode: 400, statusMessage: `persona ${member.persona} has no recipe to spawn` })
  }

  // Resolve the recipe param templates against this org.
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(persona.recipeParams ?? {})) {
    params[k] = typeof v === 'string'
      ? v.replace('{{org_id}}', org.id).replace('{{org_name}}', org.name)
      : v
  }

  const r = await dispatchSpawnIntent(owner, {
    name: member.agentName,
    recipe: { repoRef: persona.recipeRef, params },
  })

  await db.update(orgMembers)
    .set({ spawnIntentId: r.intentId, spawnStatus: 'pending', spawnError: null })
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.agentEmail, email)))

  return { intent_id: r.intentId, host_id: r.hostId, hostname: r.hostname, ref: r.ref ?? null }
})
