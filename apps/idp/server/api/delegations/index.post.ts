import { createCreateDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createCreateDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
