import { createAddSshKeyHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createAddSshKeyHandler(useIdPStores(), useIdPConfig())(event)
})
