import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { orgMembers } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'
import { getPersona } from '../../../../utils/persona-catalog'

// Members of an org, oldest first (owner-only). Ported from openape-org (B0).
// Each row is enriched with the persona's display title + icon (resolved
// server-side — the catalog is a server util) so the org-chart client can show
// them without importing server code.
export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const db = useDb()
  const rows = await db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id)).orderBy(asc(orgMembers.createdAt))
  return rows.map((m) => {
    const persona = getPersona(m.persona)
    return { ...m, personaTitle: persona?.title ?? null, personaIcon: persona?.icon ?? null }
  })
})
