import { createEnrollHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createEnrollHandler(useIdPStores(), useIdPConfig())(event)
})
