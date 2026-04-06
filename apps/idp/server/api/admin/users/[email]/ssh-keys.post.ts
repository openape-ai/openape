import { createAddSshKeyHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createAddSshKeyHandler(useIdPStores(), useIdPConfig())(event)
})
