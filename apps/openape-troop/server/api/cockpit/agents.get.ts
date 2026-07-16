import { eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitAgents, organizations } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'

// All of the owner's agents across every org, with their org name — the target
// list for assigning library (cross-company) skills.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const db = useDb()
  const [agents, orgs] = await Promise.all([
    db.select().from(cockpitAgents).where(eq(cockpitAgents.ownerEmail, owner)),
    db.select().from(organizations).where(eq(organizations.ownerEmail, owner)),
  ])
  const orgName = new Map(orgs.map(o => [o.id, o.name]))
  return agents
    .filter(a => a.enabled)
    .map(a => ({ id: a.id, label: a.label, role: a.role, orgId: a.orgId, orgName: orgName.get(a.orgId) ?? a.orgId }))
})
