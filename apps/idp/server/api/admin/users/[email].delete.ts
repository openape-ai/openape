import { createDeleteUserHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createDeleteUserHandler(useIdPStores(), useIdPConfig())(event)
})
