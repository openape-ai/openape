import { createTokenHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createTokenHandler(useIdPStores(), useIdPConfig())(event)
})
