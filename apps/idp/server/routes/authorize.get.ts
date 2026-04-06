import { createAuthorizeHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createAuthorizeHandler(useIdPStores(), useIdPConfig())(event)
})
