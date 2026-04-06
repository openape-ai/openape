import { createGetGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createGetGrantHandler(useIdPStores())(event)
})
