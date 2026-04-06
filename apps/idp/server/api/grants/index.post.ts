import { createCreateGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createCreateGrantHandler(useIdPStores(), useIdPConfig())(event)
})
