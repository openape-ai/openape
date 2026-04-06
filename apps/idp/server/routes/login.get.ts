import { createLoginPageHandler } from '@openape/server/handlers'

export default defineEventHandler(async (event) => {
  return createLoginPageHandler()(event)
})
