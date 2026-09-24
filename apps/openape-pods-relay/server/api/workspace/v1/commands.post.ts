import { centralId, centralObject, centralRevision, parseCentralCommand } from '../../../../../openape-pods/src/contracts/central'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBody, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event)
  const body = centralObject(await workspaceBody(event, 256 * 1024))
  setResponseStatus(event, 202)
  return workspace().submit(owner, centralId(body.runtimeId), centralRevision(body.revision), parseCentralCommand(body.command), centralId(body.id))
})))
