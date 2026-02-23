import { createSPManifest } from '@openape/auth'

export default defineEventHandler((event) => {
  const { spId, spName } = getSpConfig()
  const origin = getRequestURL(event).origin
  return createSPManifest({
    sp_id: spId,
    name: spName,
    redirect_uris: [`${origin}/api/callback`],
    description: 'DDISA Sample Service Provider with OpenAPE integration',
  })
})
