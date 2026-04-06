import { createGrantTokenHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createGrantTokenHandler(useIdPStores(), useIdPConfig())(event)
})
