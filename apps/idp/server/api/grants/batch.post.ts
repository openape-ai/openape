import { createBatchGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createBatchGrantHandler(useIdPStores(), useIdPConfig())(event)
})
