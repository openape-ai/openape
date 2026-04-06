import { createEnrollHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createEnrollHandler(useIdPStores(), useIdPConfig())(event)
})
