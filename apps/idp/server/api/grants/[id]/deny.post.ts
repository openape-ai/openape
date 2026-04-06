import { createDenyGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createDenyGrantHandler(useIdPStores(), useIdPConfig())(event)
})
