import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { nests } from '../../database/schema'
import { requireOwnerWithScope } from '../../utils/auth'

// GET /api/nests — list the Owner's bound devices (M4δ). Gated by
// `nest:report-status` (a bound device reading its own siblings) — the
// first-party Owner session/CLI token auto-passes the scope check.
//
// Revoked rows are included so the UI can show binding history; the
// caller filters on `status` if it only wants live devices.
export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnerWithScope(event, 'nest:report-status')
  const db = useDb()

  const rows = await db
    .select({
      hostId: nests.hostId,
      displayName: nests.displayName,
      podUuid: nests.podUuid,
      status: nests.status,
      createdAt: nests.createdAt,
      lastSeenAt: nests.lastSeenAt,
    })
    .from(nests)
    .where(and(eq(nests.ownerEmail, owner.toLowerCase())))
    .orderBy(desc(nests.createdAt))

  return rows.map(r => ({
    host_id: r.hostId,
    display_name: r.displayName,
    pod_uuid: r.podUuid,
    status: r.status,
    created_at: r.createdAt,
    last_seen_at: r.lastSeenAt,
  }))
})
