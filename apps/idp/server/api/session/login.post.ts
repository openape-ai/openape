import { createSessionLoginHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createSessionLoginHandler(useIdPStores(), useIdPConfig())(event)
})
