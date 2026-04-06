import { createConsumeGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createConsumeGrantHandler(useIdPStores())(event)
})
