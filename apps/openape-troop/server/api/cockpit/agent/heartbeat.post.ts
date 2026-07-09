import { markAgentPoll } from '../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../utils/cockpit/auth'

// The reactive brain pings this each burst cycle and once more when it goes to
// sleep, passing nextPollInMs = when it will next check in. That single number
// lets the cockpit tell active / idle(+countdown) / working / offline apart.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const body = await readBody<{ nextPollInMs?: number }>(event)
  const n = typeof body?.nextPollInMs === 'number' && body.nextPollInMs > 0 ? body.nextPollInMs : undefined
  markAgentPoll(agent, n)
  return { ok: true }
})
