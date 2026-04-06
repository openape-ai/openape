import { createRevokeGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createRevokeGrantHandler(useIdPStores(), useIdPConfig())(event)
})
