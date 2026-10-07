import { boundary } from '../../utils/service'
import { signOut } from '../../utils/inbox-service'
import { workspaceOrigin } from '../../utils/workspace'

export default defineEventHandler(event => boundary(event, async () => {
  workspaceOrigin(event)
  await signOut(event)
  return { ok: true }
}))
