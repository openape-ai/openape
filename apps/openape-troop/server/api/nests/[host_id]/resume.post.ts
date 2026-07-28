import { parseAgentEmail } from '../../../utils/agent-email'
import { requireOwnerWithScope } from '../../../utils/auth'
import { dispatchPause } from '../../../utils/pause-dispatch'

// POST /api/nests/:host_id/resume — resume a paused fleet. Per-agent pauses set
// individually still stand; this only clears the nest-wide switch.

export default defineEventHandler(async (event) => {
  const { owner: caller } = await requireOwnerWithScope(event, 'troop:pause-agent')
  const owner = parseAgentEmail(caller)?.ownerEmail ?? caller
  const hostId = getRouterParam(event, 'host_id') ?? ''
  if (!hostId) throw createError({ statusCode: 400, statusMessage: 'host_id required' })
  const r = dispatchPause(owner, { hostId, paused: false })
  return { ok: true, paused: false, host_id: r.hostId, hostname: r.hostname }
})
