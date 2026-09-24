import { setTimeout as delay } from 'node:timers/promises'
import { centralRevision } from '../../../../../openape-pods/src/contracts/central'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const owner = await workspaceOwner(event)
  const cursor = centralRevision(Number(getQuery(event).cursor ?? 0))
  const deadline = Date.now() + 25000
  while (Date.now() < deadline && !event.node.res.destroyed && workspace().cursor(owner) === cursor) await delay(250)
  await workspaceOwner(event)
  return { cursor: workspace().cursor(owner) }
})))
