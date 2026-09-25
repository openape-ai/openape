import { createClientMetadata } from '@openape/auth'

export default defineEventHandler(() => {
  const origin = String(useRuntimeConfig().relayOrigin)
  return createClientMetadata({ client_id: new URL(origin).host, client_name: 'OpenApe Pods', redirect_uris: [`${origin}/mobile-auth/callback`, ...(useRuntimeConfig().workspaceEnabled ? [`${origin}/workspace-auth/callback`] : [])], client_uri: origin, contacts: [] })
})
