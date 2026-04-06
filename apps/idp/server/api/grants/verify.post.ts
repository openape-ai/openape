import { createVerifyGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createVerifyGrantHandler(useIdPStores(), useIdPConfig())(event)
})
