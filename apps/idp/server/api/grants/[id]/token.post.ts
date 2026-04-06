import { createGrantTokenHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createGrantTokenHandler(useIdPStores(), useIdPConfig())(event)
})
