import { text } from '@openape/pods-protocol'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBoundary, workspaceOwner, workspaceView } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event); const query = getQuery(event)
  const view = workspaceView(query)
  const runtimeId = text(query.runtimeId, 36)
  if (view?.view === 'map') return workspace().view(owner, runtimeId, null, view)
  const podId = text(query.podId, 36)
  return view ? workspace().view(owner, runtimeId, podId, view) : workspace().read(owner, runtimeId, podId)
})))
