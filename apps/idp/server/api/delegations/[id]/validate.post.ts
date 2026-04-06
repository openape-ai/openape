import { createValidateDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createValidateDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
