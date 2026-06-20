import { parseAgentEmail } from '../../../utils/agent-email'
import { requireOwnerWithScope } from '../../../utils/auth'
import { dispatchPause } from '../../../utils/pause-dispatch'

// POST /api/nests/:host_id/pause — pause every agent on a nest (fleet
// kill-switch). Agents stay connected; none run LLM turns until /resume.

export default defineEventHandler(async (event) => {
  const { owner: caller } = await requireOwnerWithScope(event, 'troop:pause-agent')
  const owner = parseAgentEmail(caller)?.ownerEmail ?? caller
  const hostId = getRouterParam(event, 'host_id') ?? ''
  if (!hostId) throw createError({ statusCode: 400, statusMessage: 'host_id required' })
  const r = dispatchPause(owner, { hostId, paused: true })
  return { ok: true, paused: true, host_id: r.hostId, hostname: r.hostname }
})
