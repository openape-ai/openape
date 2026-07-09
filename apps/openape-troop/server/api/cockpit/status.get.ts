import { agentRecentlyActive } from '../../utils/cockpit/queue'
import { cockpitOwner } from '../../utils/cockpit/auth'

// Is this owner's reactive CEO brain currently connected? Drives the header
// indicator so the chat shows whether answers are real or mocked.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  return { connected: agentRecentlyActive(owner) }
})
