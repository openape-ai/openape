import { createSessionLoginHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createSessionLoginHandler(useIdPStores(), useIdPConfig())(event)
})
