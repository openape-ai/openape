import { createAuthenticateHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createAuthenticateHandler(useIdPStores(), useIdPConfig())(event)
})
