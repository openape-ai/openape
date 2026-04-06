import { createCreateGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createCreateGrantHandler(useIdPStores(), useIdPConfig())(event)
})
