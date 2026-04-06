import { createDiscoveryHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createDiscoveryHandler(useIdPConfig())(event)
})
