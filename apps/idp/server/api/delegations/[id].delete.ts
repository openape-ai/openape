import { createRevokeDelegationHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createRevokeDelegationHandler(useIdPStores(), useIdPConfig())(event)
})
