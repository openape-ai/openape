import { createDenyGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createDenyGrantHandler(useIdPStores(), useIdPConfig())(event)
})
