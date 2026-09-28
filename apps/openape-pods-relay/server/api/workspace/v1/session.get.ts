import { boundary } from '../../../utils/service'
import { workspaceOwner } from '../../../utils/workspace'

export default defineEventHandler(event => boundary(event, async () => {
  const owner = await workspaceOwner(event)
  return { subject: owner.subject }
}))
