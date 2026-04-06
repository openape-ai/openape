import { createDeleteUserHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createDeleteUserHandler(useIdPStores(), useIdPConfig())(event)
})
