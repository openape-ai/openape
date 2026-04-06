import { createConsumeGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createConsumeGrantHandler(useIdPStores())(event)
})
