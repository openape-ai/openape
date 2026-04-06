import { createChallengeHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createChallengeHandler(useIdPStores(), useIdPConfig())(event)
})
