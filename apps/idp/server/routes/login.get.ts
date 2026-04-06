import { createLoginPageHandler } from '@openape/server/handlers'

export default defineEventHandler((event) => {
  return createLoginPageHandler()(event)
})
