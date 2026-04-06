import { createRevokeDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createRevokeDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
