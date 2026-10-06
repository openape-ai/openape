import { boundary } from '../../../utils/service'
import { workspace, workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, async () => workspace().inventory(await workspaceOwner(event))))
