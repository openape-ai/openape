import { createDeleteSshKeyHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createDeleteSshKeyHandler(useIdPStores(), useIdPConfig())(event)
})
