import { createCreateDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createCreateDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
