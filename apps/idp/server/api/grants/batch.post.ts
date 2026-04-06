import { createBatchGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createBatchGrantHandler(useIdPStores(), useIdPConfig())(event)
})
