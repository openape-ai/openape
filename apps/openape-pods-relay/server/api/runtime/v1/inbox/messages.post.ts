import { parseInboxMessagesCommand } from '../../../../../../openape-pods/src/contracts/inbox'
import { inboxStore } from '../../../../utils/inbox-service'
import { actor, boundary } from '../../../../utils/service'
import { workspaceBody, workspaceBoundary } from '../../../../utils/workspace'

// A signed-in desktop is a device of its owner's account and sees the same messages as the owner (issue 1487).
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const runtime = actor(event)
  return inboxStore().messages(runtime.owner, parseInboxMessagesCommand(await workspaceBody(event, 1024)))
})))
