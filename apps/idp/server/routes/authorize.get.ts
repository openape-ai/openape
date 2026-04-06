import { createAuthorizeHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createAuthorizeHandler(useIdPStores(), useIdPConfig())(event)
})
