import { text } from '@openape/pods-protocol'
import { boundary } from '../../../utils/service'
import { workspace, workspaceBoundary, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => workspace().visibleOperation(await workspaceOwner(event), text(getQuery(event).id, 36)))))
