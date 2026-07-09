import { markAgentPoll } from '../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../utils/cockpit/auth'

// The reactive brain pings this once per burst cycle so the cockpit knows it's
// connected even while it's busy serving another service's queue (round-robin).
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  markAgentPoll(agent)
  return { ok: true }
})
