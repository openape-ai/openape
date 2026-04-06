import { createCreateUserHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createCreateUserHandler(useIdPStores(), useIdPConfig())(event)
})
