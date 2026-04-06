import { createListGrantsHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createListGrantsHandler(useIdPStores(), useIdPConfig())(event)
})
