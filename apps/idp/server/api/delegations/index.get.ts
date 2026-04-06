import { createListDelegationsHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createListDelegationsHandler(useIdPStores(), useIdPConfig())(event)
})
