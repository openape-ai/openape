import { createJWKSHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createJWKSHandler(useIdPStores())(event)
})
