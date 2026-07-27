import { desc, eq, sql } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { agents, organizations, orgMembers, runs, tasks } from '../../database/schema'
import { requireOwner } from '../../utils/auth'

// List the owner's agents with a few joined summary columns so the
// UI doesn't need a fan-out per row: task count + most-recent run
// status. Both subqueries are cheap on libsql for our expected data
// volume (handful of agents per owner, tasks low double-digits).
//
// Org membership rides along the same way (subquery, not a join) so an agent
// stays exactly one row — `ape-troop agents list` groups by company and the
// nests UI indexes rows per agent; a join would duplicate both if an agent
// ever joins a second org. `created_at` picks the earliest membership as the
// agent's home company, so the pick is stable instead of arbitrary.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const ownerEmail = owner.toLowerCase()
  const db = useDb()

  const rows = await db
    .select({
      email: agents.email,
      agentName: agents.agentName,
      hostId: agents.hostId,
      hostname: agents.hostname,
      nestHostId: agents.nestHostId,
      pubkeySsh: agents.pubkeySsh,
      firstSeenAt: agents.firstSeenAt,
      lastSeenAt: agents.lastSeenAt,
      createdAt: agents.createdAt,
      taskCount: sql<number>`(SELECT COUNT(*) FROM ${tasks} WHERE ${tasks.agentEmail} = ${agents.email})`,
      lastRunStatus: sql<string | null>`(SELECT status FROM ${runs} WHERE ${runs.agentEmail} = ${agents.email} ORDER BY ${runs.startedAt} DESC LIMIT 1)`,
      lastRunAt: sql<number | null>`(SELECT started_at FROM ${runs} WHERE ${runs.agentEmail} = ${agents.email} ORDER BY ${runs.startedAt} DESC LIMIT 1)`,
      orgId: sql<string | null>`(SELECT ${orgMembers.orgId} FROM ${orgMembers} WHERE ${orgMembers.agentEmail} = ${agents.email} AND ${orgMembers.status} = 'active' AND EXISTS (SELECT 1 FROM ${organizations} WHERE ${organizations.id} = ${orgMembers.orgId} AND ${organizations.ownerEmail} = ${ownerEmail}) ORDER BY ${orgMembers.createdAt} LIMIT 1)`,
      orgName: sql<string | null>`(SELECT ${organizations.name} FROM ${orgMembers} INNER JOIN ${organizations} ON ${organizations.id} = ${orgMembers.orgId} WHERE ${orgMembers.agentEmail} = ${agents.email} AND ${orgMembers.status} = 'active' AND ${organizations.ownerEmail} = ${ownerEmail} ORDER BY ${orgMembers.createdAt} LIMIT 1)`,
      orgRole: sql<string | null>`(SELECT ${orgMembers.role} FROM ${orgMembers} WHERE ${orgMembers.agentEmail} = ${agents.email} AND ${orgMembers.status} = 'active' AND EXISTS (SELECT 1 FROM ${organizations} WHERE ${organizations.id} = ${orgMembers.orgId} AND ${organizations.ownerEmail} = ${ownerEmail}) ORDER BY ${orgMembers.createdAt} LIMIT 1)`,
      reportsToEmail: sql<string | null>`(SELECT ${orgMembers.reportsToEmail} FROM ${orgMembers} WHERE ${orgMembers.agentEmail} = ${agents.email} AND ${orgMembers.status} = 'active' AND EXISTS (SELECT 1 FROM ${organizations} WHERE ${organizations.id} = ${orgMembers.orgId} AND ${organizations.ownerEmail} = ${ownerEmail}) ORDER BY ${orgMembers.createdAt} LIMIT 1)`,
    })
    .from(agents)
    .where(eq(agents.ownerEmail, ownerEmail))
    .orderBy(desc(agents.createdAt))

  return rows
})
