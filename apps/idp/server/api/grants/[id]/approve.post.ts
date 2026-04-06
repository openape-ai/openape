import { createApproveGrantHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createApproveGrantHandler(useIdPStores(), useIdPConfig())(event)
})
