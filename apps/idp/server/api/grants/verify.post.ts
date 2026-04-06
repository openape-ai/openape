import { createVerifyGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createVerifyGrantHandler(useIdPStores(), useIdPConfig())(event)
})
