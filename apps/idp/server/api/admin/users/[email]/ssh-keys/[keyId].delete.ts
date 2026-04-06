import { createDeleteSshKeyHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createDeleteSshKeyHandler(useIdPStores(), useIdPConfig())(event)
})
