import { parseInboxMessagesCommand } from '../../../../../openape-pods/src/contracts/inbox'
import { inboxStore } from '../../../utils/inbox-service'
import { boundary } from '../../../utils/service'
import { workspaceBody, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

// The signed-in owner lists and marks the account's messages from the browser workspace (issue 1487).
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event)
  return inboxStore().messages(owner, parseInboxMessagesCommand(await workspaceBody(event, 1024)))
})))
