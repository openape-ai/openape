import { createListSshKeysHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createListSshKeysHandler(useIdPStores(), useIdPConfig())(event)
})
