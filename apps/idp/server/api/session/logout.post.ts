import { createSessionLogoutHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createSessionLogoutHandler(useIdPStores(), useIdPConfig())(event)
})
