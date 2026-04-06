import { createTokenHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createTokenHandler(useIdPStores(), useIdPConfig())(event)
})
