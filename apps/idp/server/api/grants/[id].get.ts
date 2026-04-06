import { createGetGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createGetGrantHandler(useIdPStores())(event)
})
