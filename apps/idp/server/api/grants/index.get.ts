import { createListGrantsHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createListGrantsHandler(useIdPStores(), useIdPConfig())(event)
})
