import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitAgents } from '../../database/schema'

// The task-level command allowlist (#1036): the deduplicated union of the
// tool patterns of every ENABLED role in the org. Derived server-side at
// enqueue time so the worker enforces data the client can never widen —
// an empty result means "hard sandbox, no commands".
export async function orgAllowedTools(ownerEmail: string, orgId: string): Promise<string[]> {
  const rows = await useDb()
    .select({ enabled: cockpitAgents.enabled, tools: cockpitAgents.tools })
    .from(cockpitAgents)
    .where(and(eq(cockpitAgents.ownerEmail, ownerEmail), eq(cockpitAgents.orgId, orgId)))
  return [...new Set(rows.filter(r => r.enabled).flatMap(r => r.tools).filter(Boolean))]
}
