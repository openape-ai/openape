import { createListUsersHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createListUsersHandler(useIdPStores(), useIdPConfig())(event)
})
