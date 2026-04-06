import { createValidateDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createValidateDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
