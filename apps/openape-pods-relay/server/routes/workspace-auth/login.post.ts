import { defineOpenApeLoginHandler } from '@openape/nuxt-auth-sp/handlers'
import { boundary } from '../../utils/service'
import { workspaceOrigin, workspaceSession } from '../../utils/workspace'

const login = defineOpenApeLoginHandler({ callbackPath: '/workspace-auth/callback' })
export default defineEventHandler(event => boundary(event, async () => {
  workspaceOrigin(event); await workspaceSession(event)
  return login(event)
}))
