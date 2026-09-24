import { text } from '@openape/pods-protocol'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event); const query = getQuery(event)
  return workspace().read(owner, text(query.runtimeId, 36), text(query.podId, 36))
})))
