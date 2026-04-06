import { createCreateUserHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createCreateUserHandler(useIdPStores(), useIdPConfig())(event)
})
