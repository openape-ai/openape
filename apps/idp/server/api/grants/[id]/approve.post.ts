import { createApproveGrantHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createApproveGrantHandler(useIdPStores(), useIdPConfig())(event)
})
