import { defineEventHandler } from 'h3'
import { getAppSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  return { csrfToken: session.data.csrfToken || '' }
})
