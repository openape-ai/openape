import { createJWKSHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createJWKSHandler(useIdPStores())(event)
})
