import { createAuthenticateHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createAuthenticateHandler(useIdPStores(), useIdPConfig())(event)
})
