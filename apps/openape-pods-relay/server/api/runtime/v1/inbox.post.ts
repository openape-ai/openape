import { actor, boundary } from '../../../utils/service'
import { workspaceBody, workspaceBoundary } from '../../../utils/workspace'
import { inboxStore } from '../../../utils/inbox-service'
import { parsePublication } from '../../../utils/inbox-store'

// A signed-in runtime publishes into its own owner's inbox; the owner always comes from the runtime registration.
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const runtime = actor(event)
  const publication = parsePublication(await workspaceBody(event, 96 * 1024))
  const receipt = inboxStore().publish(runtime.owner, runtime.id, publication)
  setResponseStatus(event, receipt.created ? 201 : 200)
  return receipt
})))
