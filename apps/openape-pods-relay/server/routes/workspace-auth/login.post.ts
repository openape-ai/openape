import { defineOpenApeLoginHandler } from '@openape/nuxt-auth-sp/handlers'
import { boundary } from '../../utils/service'
import { workspaceOrigin, workspaceSession } from '../../utils/workspace'

const login = defineOpenApeLoginHandler({ callbackPath: '/workspace-auth/callback' })
// Only same-origin inbox paths may be resumed after sign-in; everything else returns to the workspace.
const inboxPath = /^\/inbox(?:\/[\w-]+)*\/?(?:\?[\w=&-]{1,200})?$/
export default defineEventHandler(event => boundary(event, async () => {
  workspaceOrigin(event)
  const session = await workspaceSession(event)
  const returnTo = (await readBody<{ returnTo?: unknown }>(event))?.returnTo
  await session.update({ returnTo: typeof returnTo === 'string' && inboxPath.test(returnTo) ? returnTo : undefined })
  return login(event)
}))
