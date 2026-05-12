import { listNestPeersForOwner } from '../../utils/nest-registry'
import { requireOwner } from '../../utils/auth'

// GET /api/nest/hosts — return the owner's currently-connected
// nest daemons. UI uses this for the live-status badge on each
// agent-detail page ("● live: Mac-mini-von-Patrick" vs
// "○ polling — nest offline"), and for the host-picker in the
// spawn-agent dialog when the owner has multiple connected Macs.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  return listNestPeersForOwner(owner).map(p => ({
    host_id: p.hostId,
    hostname: p.hostname,
    version: p.version,
    last_seen_at: p.lastSeenAt,
  }))
})
