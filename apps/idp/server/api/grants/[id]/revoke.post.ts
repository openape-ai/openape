import { createRevokeGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createRevokeGrantHandler(useIdPStores(), useIdPConfig())(event)
})
