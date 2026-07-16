import { agentStatus } from '../../utils/cockpit/queue'
import { cockpitOwner } from '../../utils/cockpit/auth'

// The owner's Operator brain state — drives the header indicator (live / Ruhemodus
// +countdown / arbeitet / offline).
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  return agentStatus(owner)
})
