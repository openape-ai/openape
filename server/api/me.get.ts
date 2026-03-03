import { defineEventHandler } from 'h3'
import { getAppSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const userId = session.data.userId

  return userId ? { email: userId } : null
})
