import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { agents } from '../../../database/schema'
import { parseAgentEmail } from '../../../utils/agent-email'
import { requireOwnerWithScope } from '../../../utils/auth'
import { dispatchPause } from '../../../utils/pause-dispatch'

// POST /api/agents/:name/pause — pause one agent on a connected nest. The agent
// stays enrolled + WS-connected but runs no LLM turns (zero tokens). Reversible
// via /resume. Optional host_id picks a specific device (default: first nest).

const AGENT_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/
const bodySchema = z.object({ host_id: z.string().optional() })

export default defineEventHandler(async (event) => {
  const { owner: caller } = await requireOwnerWithScope(event, 'troop:pause-agent')
  const owner = parseAgentEmail(caller)?.ownerEmail ?? caller
  const name = getRouterParam(event, 'name') ?? ''
  if (!AGENT_NAME_REGEX.test(name)) {
    throw createError({ statusCode: 400, statusMessage: 'name must match /^[a-z][a-z0-9-]{0,23}$/' })
  }
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => ({})))
  const hostId = parsed.success ? parsed.data.host_id : undefined
  const r = dispatchPause(owner, { name, hostId, paused: true })
  // Mirror the state troop just told the nest to apply, so the UI badge is right
  // on the next load (the nest registry stays authoritative for enforcement).
  await useDb().update(agents).set({ paused: true }).where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
  return { ok: true, name, paused: true, host_id: r.hostId, hostname: r.hostname }
})
