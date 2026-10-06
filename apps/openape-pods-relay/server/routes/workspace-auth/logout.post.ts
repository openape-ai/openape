import { boundary } from '../../utils/service'
import { workspaceOrigin, workspaceSession } from '../../utils/workspace'

export default defineEventHandler(event => boundary(event, async () => {
  workspaceOrigin(event)
  await (await workspaceSession(event)).clear()
  return { ok: true }
}))
