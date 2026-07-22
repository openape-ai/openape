import { markAgentDoctor, markAgentPoll } from '../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../utils/cockpit/auth'

// The reactive brain pings this each burst cycle and once more when it goes to
// sleep, passing nextPollInMs = when it will next check in. That single number
// lets the cockpit tell active / idle(+countdown) / working / offline apart.
// Optionally carries a doctor report: cli name → resolvable in the worker's env.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const body = await readBody<{ nextPollInMs?: number, doctor?: Record<string, unknown> }>(event)
  const n = typeof body?.nextPollInMs === 'number' && body.nextPollInMs > 0 ? body.nextPollInMs : undefined
  markAgentPoll(agent, n)
  if (body?.doctor && typeof body.doctor === 'object' && !Array.isArray(body.doctor)) {
    const report: Record<string, boolean> = {}
    for (const [cli, ok] of Object.entries(body.doctor)) {
      if (/^[\w@./-]{1,64}$/.test(cli)) report[cli] = ok === true
    }
    markAgentDoctor(agent, report)
  }
  return { ok: true }
})
