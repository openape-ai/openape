import { text } from '@openape/pods-protocol'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event); const query = getQuery(event)
  setHeader(event, 'content-type', 'application/octet-stream')
  setHeader(event, 'content-disposition', 'attachment')
  setHeader(event, 'x-content-type-options', 'nosniff')
  return Buffer.from(workspace().artifact(owner, text(query.runtimeId, 36), text(query.podId, 36), text(query.path, 4096)))
})))
