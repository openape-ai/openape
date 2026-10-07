import { defineOpenApeLoginHandler } from '@openape/nuxt-auth-sp/handlers'
import { boundary } from '../../utils/service'
import { inboxReturn, workspaceOrigin, workspaceSession } from '../../utils/workspace'

const login = defineOpenApeLoginHandler({ callbackPath: '/workspace-auth/callback' })
export default defineEventHandler(event => boundary(event, async () => {
  workspaceOrigin(event); await workspaceSession(event)
  inboxReturn.remember(event, (await readBody<{ returnTo?: unknown }>(event))?.returnTo)
  return login(event)
}))
