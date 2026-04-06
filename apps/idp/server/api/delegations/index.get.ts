import { createListDelegationsHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createListDelegationsHandler(useIdPStores(), useIdPConfig())(event)
})
