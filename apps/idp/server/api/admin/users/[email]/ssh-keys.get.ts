import { createListSshKeysHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createListSshKeysHandler(useIdPStores(), useIdPConfig())(event)
})
