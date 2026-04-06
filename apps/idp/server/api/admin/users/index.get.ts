import { createListUsersHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createListUsersHandler(useIdPStores(), useIdPConfig())(event)
})
