import { eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { cockpitYoloSync } from '../../../../database/schema'
import { orgAllowedTools } from '../../../../utils/cockpit/allowed-tools'
import { requireOwnedOrg } from '../../../../utils/cockpit/org-access'
import { diffTools } from '../../../../utils/cockpit/yolo-drift'

// Owner-Sicht: ist die YOLO-Policy des Firmen-Operators aktuell? Vergleicht die
// aktuelle Rollen-Union mit der Liste des letzten erfolgreichen Syncs.
export default defineEventHandler(async (event) => {
  const { owner, orgId } = await requireOwnedOrg(event)
  const current = await orgAllowedTools(owner, orgId)
  const [row] = await useDb().select().from(cockpitYoloSync).where(eq(cockpitYoloSync.orgId, orgId))
  if (!row || row.ownerEmail !== owner) return { state: null, current }
  const { added, removed } = diffTools(current, row.tools)
  return {
    state: {
      opEmail: row.opEmail,
      mode: row.mode,
      patternCount: row.patternCount,
      ok: row.ok,
      error: row.error,
      syncedAt: row.syncedAt,
      reportedAt: row.reportedAt,
    },
    current,
    added,
    removed,
    inSync: row.ok && added.length === 0 && removed.length === 0,
  }
})
