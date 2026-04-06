import { createSessionLogoutHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createSessionLogoutHandler(useIdPStores(), useIdPConfig())(event)
})
